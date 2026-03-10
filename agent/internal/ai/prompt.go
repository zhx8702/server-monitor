package ai

import (
	"fmt"
	"strings"
)

// StateFetcher returns a snapshot of the current server state for the system prompt.
type StateFetcher func() map[string]string

// BuildSystemPrompt constructs the system prompt with dynamic server state.
func BuildSystemPrompt(state map[string]string) string {
	var b strings.Builder

	b.WriteString(`你是一个服务器运维 AI 助手。你可以通过工具来查询服务器状态和执行运维操作。

## 行为准则
- 执行破坏性操作（删除容器、停止服务等）前，先向用户确认
- 回复尽量简洁，使用与用户相同的语言
- 如果工具返回错误，告知用户具体原因并给出建议
- 优先使用工具获取实时数据，不要凭记忆回答系统状态问题
`)

	if len(state) > 0 {
		b.WriteString("\n## 当前服务器状态\n")
		// Write in deterministic order
		keys := []string{
			"hostname", "os", "kernel", "cpu_model", "cpu_cores",
			"cpu_usage", "memory_usage", "disk_usage",
			"docker_status", "uptime",
		}
		for _, k := range keys {
			if v, ok := state[k]; ok && v != "" {
				b.WriteString(fmt.Sprintf("- %s: %s\n", k, v))
			}
		}
		// Any extra keys not in the predefined list
		for k, v := range state {
			if v == "" {
				continue
			}
			found := false
			for _, pk := range keys {
				if k == pk {
					found = true
					break
				}
			}
			if !found {
				b.WriteString(fmt.Sprintf("- %s: %s\n", k, v))
			}
		}
	}

	return b.String()
}
