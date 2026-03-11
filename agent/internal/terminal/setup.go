package terminal

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// StatusResponse is returned by GET /api/terminal/status.
type StatusResponse struct {
	Installed  bool `json:"installed"`
	Configured bool `json:"configured"`
}

// SetupRequest is the body of POST /api/terminal/setup.
type SetupRequest struct {
	Cmd     string `json:"cmd"`               // "codex" | "claude"
	Action  string `json:"action"`            // "install" | "configure"
	BaseUrl string `json:"baseUrl,omitempty"` // API gateway URL
	ApiKey  string `json:"apiKey,omitempty"`  // API key
}

// SetupResponse is returned by POST /api/terminal/setup.
type SetupResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// HandleStatus checks if a CLI tool is installed and configured.
func (h *Handler) HandleStatus(w http.ResponseWriter, r *http.Request) {
	cmd := r.URL.Query().Get("cmd")
	if cmd != "codex" && cmd != "claude" {
		http.Error(w, `{"error":"cmd must be codex or claude"}`, http.StatusBadRequest)
		return
	}

	resp := StatusResponse{
		Installed:  isInstalled(cmd),
		Configured: isConfigured(cmd),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// HandleSetup installs or configures a CLI tool.
func (h *Handler) HandleSetup(w http.ResponseWriter, r *http.Request) {
	var req SetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	if req.Cmd != "codex" && req.Cmd != "claude" {
		http.Error(w, `{"error":"cmd must be codex or claude"}`, http.StatusBadRequest)
		return
	}

	switch req.Action {
	case "install":
		streamInstallCLI(w, req.Cmd)
	case "configure":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(configureCLI(req.Cmd, req.BaseUrl, req.ApiKey))
	default:
		http.Error(w, `{"error":"action must be install or configure"}`, http.StatusBadRequest)
	}
}

// --- SSE streaming helpers ---

type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func newSSEWriter(w http.ResponseWriter) *sseWriter {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	f, _ := w.(http.Flusher)
	return &sseWriter{w: w, flusher: f}
}

func (s *sseWriter) sendLine(line string) {
	b, _ := json.Marshal(map[string]string{"line": line})
	fmt.Fprintf(s.w, "event: output\ndata: %s\n\n", b)
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func (s *sseWriter) sendDone(resp SetupResponse) {
	b, _ := json.Marshal(resp)
	fmt.Fprintf(s.w, "event: done\ndata: %s\n\n", b)
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

// --- Core logic ---

func isInstalled(cmd string) bool {
	// Check PATH first
	if _, err := exec.LookPath(cmd); err == nil {
		return true
	}
	// Check common npm global install locations (nvm etc.)
	home := getHomeDir()
	if home == "" {
		return false
	}
	candidates := []string{"/usr/local/bin/" + cmd, "/usr/bin/" + cmd}
	nvmDir := filepath.Join(home, ".nvm", "versions", "node")
	if entries, err := os.ReadDir(nvmDir); err == nil {
		for i := len(entries) - 1; i >= 0; i-- {
			candidates = append([]string{filepath.Join(nvmDir, entries[i].Name(), "bin", cmd)}, candidates...)
		}
	}
	candidates = append(candidates, filepath.Join(home, ".local", "bin", cmd))
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	return false
}

func isConfigured(cmd string) bool {
	home := getHomeDir()
	if home == "" {
		return false
	}
	var err error
	switch cmd {
	case "codex":
		_, err = os.Stat(filepath.Join(home, ".codex", "config.toml"))
	case "claude":
		_, err = os.Stat(filepath.Join(home, ".claude", "settings.json"))
	}
	return err == nil
}

// getHomeDir returns the user home directory with a fallback for systemd services.
func getHomeDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	// Fallback: systemd may not set HOME
	if os.Getuid() == 0 {
		return "/root"
	}
	return ""
}

// streamInstallCLI streams the CLI installation progress via SSE.
func streamInstallCLI(w http.ResponseWriter, cmd string) {
	sse := newSSEWriter(w)

	var pkg string
	switch cmd {
	case "codex":
		pkg = "@openai/codex"
	case "claude":
		pkg = "@anthropic-ai/claude-code"
	default:
		sse.sendDone(SetupResponse{Success: false, Message: "unknown command"})
		return
	}

	npmPath := findNpm()

	// If npm not found, install Node.js first (streamed)
	if npmPath == "" {
		sse.sendLine("npm 未找到，尝试安装 Node.js ...")

		if ok := streamInstallNode(sse); !ok {
			return // streamInstallNode already sent done event
		}

		npmPath = findNpm()
		if npmPath == "" {
			sse.sendDone(SetupResponse{
				Success: false,
				Message: "Node.js 安装完成但未找到 npm，请手动检查",
			})
			return
		}
	}

	sse.sendLine(fmt.Sprintf("使用 npm: %s", npmPath))
	sse.sendLine(fmt.Sprintf("npm install -g %s", pkg))

	// Run npm install with streamed output
	c := exec.Command(npmPath, "install", "-g", pkg)
	c.Env = buildEnv()
	stdout, err := c.StdoutPipe()
	if err != nil {
		sse.sendDone(SetupResponse{Success: false, Message: err.Error()})
		return
	}
	c.Stderr = c.Stdout // merge stderr

	if err := c.Start(); err != nil {
		sse.sendDone(SetupResponse{Success: false, Message: fmt.Sprintf("启动失败: %v", err)})
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		sse.sendLine(scanner.Text())
	}

	if err := c.Wait(); err != nil {
		log.Printf("terminal setup: install %s failed: %v", pkg, err)
		sse.sendDone(SetupResponse{Success: false, Message: fmt.Sprintf("安装失败: %v", err)})
		return
	}

	log.Printf("terminal setup: installed %s successfully", pkg)
	sse.sendDone(SetupResponse{Success: true, Message: "安装成功"})
}

// streamInstallNode tries to install Node.js, streaming output. Returns true on success.
func streamInstallNode(sse *sseWriter) bool {
	// 1. Try system package manager
	type pmCmd struct {
		check string
		args  []string
	}
	managers := []pmCmd{
		{"apt-get", []string{"apt-get", "install", "-y", "nodejs", "npm"}},
		{"dnf", []string{"dnf", "install", "-y", "nodejs", "npm"}},
		{"yum", []string{"yum", "install", "-y", "nodejs", "npm"}},
		{"apk", []string{"apk", "add", "nodejs", "npm"}},
	}

	for _, pm := range managers {
		if _, err := exec.LookPath(pm.check); err != nil {
			continue
		}
		sse.sendLine(fmt.Sprintf("尝试 %s 安装 Node.js ...", pm.check))
		if ok := runStreamed(sse, "sudo", pm.args, nil); ok {
			sse.sendLine("Node.js 安装成功")
			return true
		}
		sse.sendLine(fmt.Sprintf("%s 安装失败，尝试其他方式 ...", pm.check))
	}

	// 2. Fall back to nvm
	home := getHomeDir()
	if home == "" {
		sse.sendDone(SetupResponse{Success: false, Message: "无法获取 home 目录"})
		return false
	}

	sse.sendLine("使用 nvm 安装 Node.js ...")
	nvmDir := filepath.Join(home, ".nvm")
	script := `set -e
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install --lts
`
	env := append(buildEnv(), "NVM_DIR="+nvmDir)
	if ok := runStreamed(sse, "bash", []string{"-c", script}, env); ok {
		sse.sendLine("nvm + Node.js 安装成功")
		return true
	}

	sse.sendDone(SetupResponse{Success: false, Message: "自动安装 Node.js 失败"})
	return false
}

// runStreamed executes a command and streams its output line by line. Returns true on success.
func runStreamed(sse *sseWriter, name string, args []string, env []string) bool {
	c := exec.Command(name, args...)
	if env != nil {
		c.Env = env
	} else {
		c.Env = buildEnv()
	}
	stdout, err := c.StdoutPipe()
	if err != nil {
		sse.sendLine(fmt.Sprintf("错误: %v", err))
		return false
	}
	c.Stderr = c.Stdout

	if err := c.Start(); err != nil {
		sse.sendLine(fmt.Sprintf("启动失败: %v", err))
		return false
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 256*1024) // handle long lines
	for scanner.Scan() {
		sse.sendLine(scanner.Text())
	}

	return c.Wait() == nil
}

// buildEnv returns os.Environ() with HOME guaranteed to be set.
func buildEnv() []string {
	env := os.Environ()
	for _, e := range env {
		if strings.HasPrefix(e, "HOME=") {
			return env
		}
	}
	// HOME not set — add it (common in systemd)
	home := getHomeDir()
	if home != "" {
		env = append(env, "HOME="+home)
	}
	return env
}

// findNpm locates the npm binary, checking PATH first, then common locations.
func findNpm() string {
	npmCmd := "npm"
	if runtime.GOOS == "windows" {
		npmCmd = "npm.cmd"
	}

	// Try PATH first
	if p, err := exec.LookPath(npmCmd); err == nil {
		return p
	}

	// Try common locations (nvm, fnm, system installs)
	home := getHomeDir()
	candidates := []string{
		"/usr/local/bin/npm",
		"/usr/bin/npm",
	}
	if home != "" {
		// Scan nvm versions directory for npm
		nvmDir := filepath.Join(home, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmDir); err == nil {
			for i := len(entries) - 1; i >= 0; i-- { // newest first
				p := filepath.Join(nvmDir, entries[i].Name(), "bin", "npm")
				candidates = append([]string{p}, candidates...)
			}
		}
		candidates = append(candidates, filepath.Join(home, ".local", "bin", "npm"))
	}

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	return ""
}

func configureCLI(cmd, baseUrl, apiKey string) SetupResponse {
	home := getHomeDir()
	if home == "" {
		return SetupResponse{Success: false, Message: "无法获取 home 目录"}
	}

	switch cmd {
	case "codex":
		return configureCodex(home, baseUrl, apiKey)
	case "claude":
		return configureClaude(home, baseUrl, apiKey)
	default:
		return SetupResponse{Success: false, Message: "unknown command"}
	}
}

func configureCodex(home, baseUrl, apiKey string) SetupResponse {
	dir := filepath.Join(home, ".codex")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("创建目录失败: %v", err)}
	}

	configContent := fmt.Sprintf(`model_provider = "OpenAI"
model = "gpt-5.4"
review_model = "gpt-5.4"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "%s"
wire_api = "responses"
requires_openai_auth = true
`, baseUrl)

	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(configContent), 0644); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 config.toml 失败: %v", err)}
	}

	authContent := fmt.Sprintf(`{"OPENAI_API_KEY":"%s"}`, apiKey)
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(authContent), 0600); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 auth.json 失败: %v", err)}
	}

	log.Printf("terminal setup: codex configured at %s", dir)
	return SetupResponse{Success: true, Message: "配置成功"}
}

func configureClaude(home, baseUrl, apiKey string) SetupResponse {
	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("创建目录失败: %v", err)}
	}

	settingsContent := fmt.Sprintf(`{"apiBaseUrl":"%s"}`, baseUrl)
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(settingsContent), 0644); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 settings.json 失败: %v", err)}
	}

	credContent := fmt.Sprintf(`{"apiKey":"%s"}`, apiKey)
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(credContent), 0600); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 .credentials.json 失败: %v", err)}
	}

	log.Printf("terminal setup: claude configured at %s", dir)
	return SetupResponse{Success: true, Message: "配置成功"}
}
