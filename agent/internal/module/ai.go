package module

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"

	"github.com/server-monitor/agent/internal/ai"
	"github.com/server-monitor/agent/internal/collector"
	"github.com/server-monitor/agent/internal/config"
)

func init() {
	Register("ai", func() Module { return &AIModule{} })
}

// AIModule provides an AI-powered chat interface for server operations.
type AIModule struct {
	handler   *ai.ChatHandler
	registry  *ai.ToolRegistry
	systemCol *collector.SystemCollector
	cpuCol    *collector.CpuCollector
	memCol    *collector.MemoryCollector
	diskCol   *collector.DiskCollector
	netCol    *collector.NetworkCollector
	procCol   *collector.ProcessCollector
	dockerCol *collector.DockerCollector
}

func (m *AIModule) Name() string { return "ai" }

func (m *AIModule) Init(cfg *config.Config) error {
	// Instantiate collectors
	m.systemCol = collector.NewSystemCollector()
	m.cpuCol = collector.NewCpuCollector()
	m.memCol = collector.NewMemoryCollector()
	m.diskCol = collector.NewDiskCollector()
	m.netCol = collector.NewNetworkCollector()
	m.procCol = collector.NewProcessCollector()

	dockerSocket := cfg.ModuleOption("docker", "socket", "/var/run/docker.sock")
	m.dockerCol = collector.NewDockerCollector(dockerSocket)

	// Build tool registry
	m.registry = ai.NewToolRegistry()
	m.registerSystemTools()
	m.registerDockerTools()

	// Create provider and handler
	provider := ai.NewProvider()
	m.handler = ai.NewChatHandler(m.registry, provider, m.fetchState)

	return nil
}

func (m *AIModule) Close() error { return nil }

func (m *AIModule) Routes() []Route {
	return []Route{
		{Method: http.MethodPost, Path: "/api/ai/chat", Handler: m.handler.HandleChat},
		{Method: http.MethodGet, Path: "/api/ai/tools", Handler: m.handler.HandleTools},
	}
}

// fetchState returns a snapshot of the current server state for the system prompt.
func (m *AIModule) fetchState() map[string]string {
	state := make(map[string]string)

	if sys, err := m.systemCol.Collect(); err == nil {
		state["hostname"] = sys.Hostname
		state["os"] = sys.OSPrettyName
		state["kernel"] = sys.KernelVersion
		state["cpu_model"] = sys.CpuModel
		state["cpu_cores"] = fmt.Sprintf("%d", sys.CpuCores)
		state["uptime"] = formatDuration(uint64(sys.UptimeSeconds))
	}

	if cpu, err := m.cpuCol.Collect(); err == nil {
		state["cpu_usage"] = fmt.Sprintf("%.1f%%", cpu.TotalPercent)
	}

	if mem, err := m.memCol.Collect(); err == nil {
		state["memory_usage"] = fmt.Sprintf("%.1f%% (%s / %s)",
			mem.UsagePercent,
			formatBytes(mem.UsedBytes),
			formatBytes(mem.TotalBytes))
	}

	docker := m.dockerCol.Collect()
	if docker.Available {
		state["docker_status"] = fmt.Sprintf("Docker %s, %d/%d containers running",
			docker.Version, docker.Summary.Running, docker.Summary.Total)
	} else {
		state["docker_status"] = "Docker not available"
	}

	return state
}

// --- System tools registration ---

func (m *AIModule) registerSystemTools() {
	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_system_info",
			Description: "获取服务器系统信息，包括主机名、操作系统、内核版本、CPU型号、内存总量、运行时长等",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap, err := m.systemCol.Collect()
		if err != nil {
			return "", err
		}
		return toJSON(snap)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_cpu_usage",
			Description: "获取CPU实时使用率，包括总使用率、用户态/内核态占比、各核心使用率、1/5/15分钟负载平均值",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap, err := m.cpuCol.Collect()
		if err != nil {
			return "", err
		}
		return toJSON(snap)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_memory_usage",
			Description: "获取内存使用情况，包括总量、已用、空闲、缓存、Swap使用情况",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap, err := m.memCol.Collect()
		if err != nil {
			return "", err
		}
		return toJSON(snap)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_disk_usage",
			Description: "获取磁盘使用情况，包括各分区的总量/已用/空闲空间和实时读写速度",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap, err := m.diskCol.Collect()
		if err != nil {
			return "", err
		}
		return toJSON(snap)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_network_stats",
			Description: "获取网络接口流量统计，包括各接口的收发速率(bytes/sec)和状态",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap, err := m.netCol.Collect()
		if err != nil {
			return "", err
		}
		return toJSON(snap)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "get_top_processes",
			Description: "获取进程列表，可按CPU或内存排序，返回指定数量的进程",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"sort_by":{"type":"string","enum":["cpu","memory"],"description":"排序字段，默认cpu"},
					"limit":{"type":"integer","description":"返回数量，默认10"}
				}
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			SortBy string `json:"sort_by"`
			Limit  int    `json:"limit"`
		}
		if argsJSON != "" {
			json.Unmarshal([]byte(argsJSON), &args)
		}
		if args.SortBy == "" {
			args.SortBy = "cpu"
		}
		if args.Limit <= 0 {
			args.Limit = 10
		}

		snap, err := m.procCol.Collect()
		if err != nil {
			return "", err
		}

		procs := snap.Processes
		switch args.SortBy {
		case "memory":
			sort.Slice(procs, func(i, j int) bool {
				return procs[i].MemPercent > procs[j].MemPercent
			})
		default:
			sort.Slice(procs, func(i, j int) bool {
				return procs[i].CPUPercent > procs[j].CPUPercent
			})
		}
		if len(procs) > args.Limit {
			procs = procs[:args.Limit]
		}

		return toJSON(map[string]any{
			"summary":   snap.Summary,
			"processes": procs,
		})
	})
}

// --- Docker tools registration ---

func (m *AIModule) registerDockerTools() {
	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_list_containers",
			Description: "列出Docker容器，可按状态过滤。返回容器名称、镜像、状态、端口映射、资源使用情况",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"state_filter":{"type":"string","enum":["all","running","stopped"],"description":"按状态过滤，默认all"}
				}
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			StateFilter string `json:"state_filter"`
		}
		if argsJSON != "" {
			json.Unmarshal([]byte(argsJSON), &args)
		}

		snap := m.dockerCol.Collect()
		if !snap.Available {
			return "", fmt.Errorf("Docker is not available: %s", snap.Error)
		}

		containers := snap.Containers
		if args.StateFilter == "running" || args.StateFilter == "stopped" {
			var filtered []collector.ContainerInfo
			for _, c := range containers {
				if args.StateFilter == "running" && c.State == "running" {
					filtered = append(filtered, c)
				} else if args.StateFilter == "stopped" && c.State != "running" {
					filtered = append(filtered, c)
				}
			}
			containers = filtered
		}

		return toJSON(map[string]any{
			"summary":    snap.Summary,
			"containers": containers,
		})
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_list_images",
			Description: "列出所有Docker镜像，包括标签、大小、创建时间",
			Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		},
	}, func(_ string) (string, error) {
		snap := m.dockerCol.Collect()
		if !snap.Available {
			return "", fmt.Errorf("Docker is not available: %s", snap.Error)
		}
		return toJSON(snap.Images)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_container_action",
			Description: "对Docker容器执行操作：启动(start)、停止(stop)、重启(restart)",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"container_id":{"type":"string","description":"容器ID或名称"},
					"action":{"type":"string","enum":["start","stop","restart"],"description":"要执行的操作"}
				},
				"required":["container_id","action"]
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			ContainerID string `json:"container_id"`
			Action      string `json:"action"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
		if args.ContainerID == "" || args.Action == "" {
			return "", fmt.Errorf("container_id and action are required")
		}

		if err := m.dockerCol.ContainerAction(args.ContainerID, args.Action); err != nil {
			return "", err
		}
		return fmt.Sprintf("Successfully executed %s on container %s", args.Action, args.ContainerID), nil
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_container_logs",
			Description: "查看Docker容器的最近日志",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"container_id":{"type":"string","description":"容器ID或名称"},
					"tail":{"type":"integer","description":"返回最后N行日志，默认50"}
				},
				"required":["container_id"]
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			ContainerID string `json:"container_id"`
			Tail        int    `json:"tail"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
		if args.ContainerID == "" {
			return "", fmt.Errorf("container_id is required")
		}
		if args.Tail <= 0 {
			args.Tail = 50
		}
		return m.dockerCol.ContainerLogs(args.ContainerID, args.Tail)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_pull_image",
			Description: "拉取Docker镜像。如果镜像已存在会更新到最新版本",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"image":{"type":"string","description":"镜像名称，例如 nginx, redis, mysql"},
					"tag":{"type":"string","description":"镜像标签，默认 latest"}
				},
				"required":["image"]
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			Image string `json:"image"`
			Tag   string `json:"tag"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
		if args.Image == "" {
			return "", fmt.Errorf("image is required")
		}
		if args.Tag == "" {
			args.Tag = "latest"
		}
		return m.dockerCol.PullImage(args.Image, args.Tag)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_create_container",
			Description: "创建并启动一个Docker容器。支持端口映射、环境变量、数据卷挂载、重启策略",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"name":{"type":"string","description":"容器名称"},
					"image":{"type":"string","description":"镜像名称（含tag），例如 nginx:latest"},
					"ports":{"type":"array","items":{"type":"object","properties":{"host_port":{"type":"integer"},"container_port":{"type":"integer"},"protocol":{"type":"string","enum":["tcp","udp"]}},"required":["host_port","container_port"]},"description":"端口映射列表"},
					"env":{"type":"array","items":{"type":"string"},"description":"环境变量列表，格式 KEY=VALUE"},
					"volumes":{"type":"array","items":{"type":"string"},"description":"数据卷挂载列表，格式 host_path:container_path"},
					"restart_policy":{"type":"string","enum":["no","always","unless-stopped","on-failure"],"description":"重启策略，默认 unless-stopped"}
				},
				"required":["name","image"]
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			Name          string `json:"name"`
			Image         string `json:"image"`
			Ports         []struct {
				HostPort      int    `json:"host_port"`
				ContainerPort int    `json:"container_port"`
				Protocol      string `json:"protocol"`
			} `json:"ports"`
			Env           []string `json:"env"`
			Volumes       []string `json:"volumes"`
			RestartPolicy string   `json:"restart_policy"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
		if args.Name == "" || args.Image == "" {
			return "", fmt.Errorf("name and image are required")
		}
		if args.RestartPolicy == "" {
			args.RestartPolicy = "unless-stopped"
		}

		opts := collector.CreateContainerOpts{
			Name:          args.Name,
			Image:         args.Image,
			Env:           args.Env,
			Volumes:       args.Volumes,
			RestartPolicy: args.RestartPolicy,
			Start:         true,
		}
		for _, p := range args.Ports {
			proto := p.Protocol
			if proto == "" {
				proto = "tcp"
			}
			opts.Ports = append(opts.Ports, collector.PortMapping{
				HostPort:      p.HostPort,
				ContainerPort: p.ContainerPort,
				Protocol:      proto,
			})
		}

		return m.dockerCol.CreateContainer(opts)
	})

	m.registry.Register(ai.ToolDef{
		Type: "function",
		Function: ai.FunctionDef{
			Name:        "docker_remove_container",
			Description: "删除一个Docker容器。如果容器正在运行，需要设置force=true强制删除",
			Parameters: json.RawMessage(`{
				"type":"object",
				"properties":{
					"container_id":{"type":"string","description":"容器ID或名称"},
					"force":{"type":"boolean","description":"是否强制删除运行中的容器，默认false"}
				},
				"required":["container_id"]
			}`),
		},
	}, func(argsJSON string) (string, error) {
		var args struct {
			ContainerID string `json:"container_id"`
			Force       bool   `json:"force"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
		if args.ContainerID == "" {
			return "", fmt.Errorf("container_id is required")
		}
		if err := m.dockerCol.RemoveContainer(args.ContainerID, args.Force); err != nil {
			return "", err
		}
		return fmt.Sprintf("Container %s removed successfully", args.ContainerID), nil
	})
}

// --- helpers ---

func toJSON(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func formatBytes(b uint64) string {
	const (
		kb = 1024
		mb = kb * 1024
		gb = mb * 1024
	)
	switch {
	case b >= gb:
		return fmt.Sprintf("%.1fGB", float64(b)/float64(gb))
	case b >= mb:
		return fmt.Sprintf("%.1fMB", float64(b)/float64(mb))
	case b >= kb:
		return fmt.Sprintf("%.1fKB", float64(b)/float64(kb))
	default:
		return strconv.FormatUint(b, 10) + "B"
	}
}

func formatDuration(seconds uint64) string {
	d := seconds / 86400
	h := (seconds % 86400) / 3600
	m := (seconds % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	}
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}
