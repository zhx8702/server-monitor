package plugin

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Store fetches plugin metadata and binaries from GitHub Releases.
type Store struct {
	repos  []string // e.g. ["github.com/your-org/sm-plugin-mysql"]
	client *http.Client
}

// RemotePlugin describes a plugin available in the store.
type RemotePlugin struct {
	Name          string `json:"name"`
	LatestVersion string `json:"latestVersion"`
	Description   string `json:"description,omitempty"`
	Source        string `json:"source"`
}

// ghRelease is the GitHub API response for a release.
type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

// ghAsset is a single file attached to a GitHub release.
type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// NewStore creates a store client from a list of GitHub repo paths.
func NewStore(repos []string) *Store {
	return &Store{
		repos: repos,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Index returns metadata for all plugins available across configured repos.
func (s *Store) Index() []RemotePlugin {
	var plugins []RemotePlugin
	for _, repo := range s.repos {
		owner, repoName := parseGitHubRepo(repo)
		if owner == "" {
			continue
		}

		releases, err := s.fetchReleases(owner, repoName)
		if err != nil {
			log.Printf("Store: cannot fetch releases for %s: %v", repo, err)
			continue
		}
		if len(releases) == 0 {
			continue
		}

		latest := releases[0] // GitHub returns newest first
		pluginName := strings.TrimPrefix(repoName, "sm-plugin-")

		plugins = append(plugins, RemotePlugin{
			Name:          pluginName,
			LatestVersion: strings.TrimPrefix(latest.TagName, "v"),
			Source:        repo,
		})
	}
	return plugins
}

// Download downloads a plugin binary and plugin.yaml into destDir.
// If version is empty, the latest release is used.
func (s *Store) Download(name, version, destDir string) error {
	// Find the repo for this plugin
	var owner, repoName string
	for _, repo := range s.repos {
		o, r := parseGitHubRepo(repo)
		rName := strings.TrimPrefix(r, "sm-plugin-")
		if rName == name {
			owner, repoName = o, r
			break
		}
	}
	if owner == "" {
		return fmt.Errorf("plugin %q not found in configured stores", name)
	}

	// Fetch releases
	releases, err := s.fetchReleases(owner, repoName)
	if err != nil {
		return fmt.Errorf("fetch releases: %w", err)
	}
	if len(releases) == 0 {
		return fmt.Errorf("no releases found for %s/%s", owner, repoName)
	}

	// Find the target release
	var release *ghRelease
	if version == "" || version == "latest" {
		release = &releases[0]
	} else {
		tag := version
		if !strings.HasPrefix(tag, "v") {
			tag = "v" + tag
		}
		for i := range releases {
			if releases[i].TagName == tag {
				release = &releases[i]
				break
			}
		}
		if release == nil {
			return fmt.Errorf("version %s not found for %s/%s", version, owner, repoName)
		}
	}

	// Determine architecture suffix
	archSuffix := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)

	// Download binary
	binaryAsset := findAsset(release.Assets, archSuffix)
	if binaryAsset == nil {
		return fmt.Errorf("no binary found for %s in release %s", archSuffix, release.TagName)
	}

	binaryName := "sm-plugin-" + name
	binaryPath := filepath.Join(destDir, binaryName)
	if err := s.downloadFile(binaryAsset.BrowserDownloadURL, binaryPath); err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	if err := os.Chmod(binaryPath, 0755); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	// Download plugin.yaml if available
	yamlAsset := findAssetByName(release.Assets, "plugin.yaml")
	if yamlAsset != nil {
		yamlPath := filepath.Join(destDir, "plugin.yaml")
		if err := s.downloadFile(yamlAsset.BrowserDownloadURL, yamlPath); err != nil {
			log.Printf("Store: warning: cannot download plugin.yaml for %s: %v", name, err)
		}
	}

	return nil
}

// fetchReleases returns releases for a GitHub repo (newest first).
func (s *Store) fetchReleases(owner, repo string) ([]ghRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=10", owner, repo)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	// Use GITHUB_TOKEN if available for higher rate limits
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body))
	}

	var releases []ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("decode releases: %w", err)
	}
	return releases, nil
}

// downloadFile downloads a URL to a local file path.
func (s *Store) downloadFile(url, destPath string) error {
	resp, err := s.client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

// parseGitHubRepo extracts owner and repo from a GitHub path.
// Input: "github.com/owner/repo" → ("owner", "repo")
func parseGitHubRepo(path string) (string, string) {
	path = strings.TrimPrefix(path, "https://")
	path = strings.TrimPrefix(path, "http://")
	path = strings.TrimPrefix(path, "github.com/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", ""
	}
	return parts[0], parts[1]
}

// findAsset finds a release asset whose name contains the given suffix.
func findAsset(assets []ghAsset, suffix string) *ghAsset {
	for i := range assets {
		if strings.Contains(assets[i].Name, suffix) && assets[i].Name != "plugin.yaml" {
			return &assets[i]
		}
	}
	return nil
}

// findAssetByName finds a release asset by exact filename.
func findAssetByName(assets []ghAsset, name string) *ghAsset {
	for i := range assets {
		if assets[i].Name == name {
			return &assets[i]
		}
	}
	return nil
}
