package terminal

import (
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

	w.Header().Set("Content-Type", "application/json")

	switch req.Action {
	case "install":
		resp := installCLI(req.Cmd)
		json.NewEncoder(w).Encode(resp)
	case "configure":
		resp := configureCLI(req.Cmd, req.BaseUrl, req.ApiKey)
		json.NewEncoder(w).Encode(resp)
	default:
		http.Error(w, `{"error":"action must be install or configure"}`, http.StatusBadRequest)
	}
}

func isInstalled(cmd string) bool {
	_, err := exec.LookPath(cmd)
	return err == nil
}

func isConfigured(cmd string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	switch cmd {
	case "codex":
		_, err = os.Stat(filepath.Join(home, ".codex", "config.toml"))
	case "claude":
		_, err = os.Stat(filepath.Join(home, ".claude", "settings.json"))
	}
	return err == nil
}

func installCLI(cmd string) SetupResponse {
	var pkg string
	switch cmd {
	case "codex":
		pkg = "@openai/codex"
	case "claude":
		pkg = "@anthropic-ai/claude-code"
	default:
		return SetupResponse{Success: false, Message: "unknown command"}
	}

	// Use npm to install globally
	npmCmd := "npm"
	if runtime.GOOS == "windows" {
		npmCmd = "npm.cmd"
	}
	out, err := exec.Command(npmCmd, "install", "-g", pkg).CombinedOutput()
	if err != nil {
		log.Printf("terminal setup: install %s failed: %v\n%s", pkg, err, out)
		return SetupResponse{
			Success: false,
			Message: fmt.Sprintf("安装失败: %v\n%s", err, strings.TrimSpace(string(out))),
		}
	}

	log.Printf("terminal setup: installed %s successfully", pkg)
	return SetupResponse{Success: true, Message: "安装成功"}
}

func configureCLI(cmd, baseUrl, apiKey string) SetupResponse {
	home, err := os.UserHomeDir()
	if err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("无法获取 home 目录: %v", err)}
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

	// Write config.toml
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

	// Write auth.json
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

	// Write settings.json
	settingsContent := fmt.Sprintf(`{"apiBaseUrl":"%s"}`, baseUrl)
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(settingsContent), 0644); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 settings.json 失败: %v", err)}
	}

	// Write .credentials.json
	credContent := fmt.Sprintf(`{"apiKey":"%s"}`, apiKey)
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(credContent), 0600); err != nil {
		return SetupResponse{Success: false, Message: fmt.Sprintf("写入 .credentials.json 失败: %v", err)}
	}

	log.Printf("terminal setup: claude configured at %s", dir)
	return SetupResponse{Success: true, Message: "配置成功"}
}
