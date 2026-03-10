package update

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/server-monitor/agent/internal/ghproxy"
	"github.com/server-monitor/agent/internal/version"
)

// Updater handles checking for and applying agent updates from GitHub Releases.
type Updater struct {
	githubRepo  string
	serviceName string
	client      *http.Client
	resolver    *ghproxy.Resolver
}

// NewUpdater creates a new Updater.
func NewUpdater(githubRepo string, resolver *ghproxy.Resolver) *Updater {
	return &Updater{
		githubRepo:  githubRepo,
		serviceName: "server-monitor-agent",
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		resolver: resolver,
	}
}

// ghRelease is the subset of GitHub Releases API we need.
type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// CheckResponse is the JSON response for GET /api/update/check.
type CheckResponse struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	ReleaseNotes    string `json:"releaseNotes,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
	AssetSize       int64  `json:"assetSize,omitempty"`
}

// Check queries the GitHub API for the latest release and compares with current.
func (u *Updater) Check() (*CheckResponse, error) {
	if u.githubRepo == "" {
		return nil, fmt.Errorf("github_repo not configured")
	}

	rawURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", u.githubRepo)
	url := u.resolver.Resolve(rawURL)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := u.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request github: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return &CheckResponse{
			CurrentVersion:  version.Version,
			LatestVersion:   version.Version,
			UpdateAvailable: false,
		}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("github API returned %d", resp.StatusCode)
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	latest := rel.TagName
	available := isNewer(version.Version, latest)

	// Find matching asset size
	assetName := fmt.Sprintf("server-monitor-agent-linux-%s", runtime.GOARCH)
	var assetSize int64
	for _, a := range rel.Assets {
		if a.Name == assetName {
			assetSize = a.Size
			break
		}
	}

	return &CheckResponse{
		CurrentVersion:  version.Version,
		LatestVersion:   latest,
		UpdateAvailable: available,
		ReleaseURL:      rel.HTMLURL,
		ReleaseNotes:    rel.Body,
		PublishedAt:     rel.PublishedAt.Format(time.RFC3339),
		AssetSize:       assetSize,
	}, nil
}

// Apply downloads the latest binary and restarts the service.
func (u *Updater) Apply() error {
	if u.githubRepo == "" {
		return fmt.Errorf("github_repo not configured")
	}

	// Get current executable path
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	// Download the binary
	assetName := fmt.Sprintf("server-monitor-agent-linux-%s", runtime.GOARCH)
	rawDownloadURL := fmt.Sprintf("https://github.com/%s/releases/latest/download/%s", u.githubRepo, assetName)
	downloadURL := u.resolver.Resolve(rawDownloadURL)

	log.Printf("Update: downloading %s", downloadURL)

	req, _ := http.NewRequest("GET", downloadURL, nil)
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download returned %d", resp.StatusCode)
	}

	// Write to temp file in same directory (ensures same filesystem for rename)
	tmpFile, err := os.CreateTemp("/tmp", "sm-agent-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	if err := os.Chmod(tmpPath, 0755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}

	// Replace current binary: copy temp → exec path
	// (can't use rename across filesystems, so copy + remove)
	if err := copyFile(tmpPath, execPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("replace binary: %w", err)
	}
	os.Remove(tmpPath)

	log.Printf("Update: binary replaced at %s, scheduling restart...", execPath)

	// Schedule service restart in background after responding
	go func() {
		time.Sleep(500 * time.Millisecond)
		log.Printf("Update: restarting %s via systemctl", u.serviceName)
		cmd := exec.Command("systemctl", "restart", u.serviceName)
		if out, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Update: restart failed: %v: %s", err, out)
		}
	}()

	return nil
}

// copyFile copies src to dst, replacing dst.
// On Linux, a running binary cannot be overwritten directly ("text file busy"),
// so we remove the old file first (the running process keeps its fd), then create a new one.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	// Remove the old file (unlink) — safe even if the binary is running
	os.Remove(dst)

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// isNewer returns true if latest is a newer semver than current.
// Handles both "v1.2.3" and "1.2.3" formats. Returns false if either is "dev".
func isNewer(current, latest string) bool {
	c := strings.TrimPrefix(current, "v")
	l := strings.TrimPrefix(latest, "v")

	if c == "dev" || c == "unknown" || c == "" {
		return l != "dev" && l != "unknown" && l != ""
	}
	if l == "dev" || l == "unknown" || l == "" {
		return false
	}

	return l != c && compareSemver(c, l) < 0
}

// compareSemver compares two semver strings. Returns -1, 0, or 1.
func compareSemver(a, b string) int {
	ap := parseSemver(a)
	bp := parseSemver(b)

	for i := 0; i < 3; i++ {
		if ap[i] < bp[i] {
			return -1
		}
		if ap[i] > bp[i] {
			return 1
		}
	}
	return 0
}

func parseSemver(s string) [3]int {
	var parts [3]int
	idx := 0
	for _, ch := range s {
		if ch == '.' {
			idx++
			if idx >= 3 {
				break
			}
			continue
		}
		if ch >= '0' && ch <= '9' {
			parts[idx] = parts[idx]*10 + int(ch-'0')
		} else {
			break // stop at pre-release suffix like "-rc1"
		}
	}
	return parts
}

// --- HTTP Handlers ---

// RegisterRoutes adds update endpoints to the mux.
func (u *Updater) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/update/check", u.handleCheck)
	mux.HandleFunc("/api/update/apply", u.handleApply)
}

func (u *Updater) handleCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	result, err := u.Check()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (u *Updater) handleApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	if err := u.Apply(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "message": "Update applied, restarting..."})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}
