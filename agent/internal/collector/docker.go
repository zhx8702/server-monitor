package collector

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ContainerInfo holds information about a single Docker container.
type ContainerInfo struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	State   string            `json:"state"`
	Status  string            `json:"status"`
	Created int64             `json:"created"`
	Ports   []ContainerPort   `json:"ports"`
	Labels  map[string]string `json:"labels,omitempty"`
	// Stats
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage   uint64  `json:"memUsage"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetRx      uint64  `json:"netRx"`
	NetTx      uint64  `json:"netTx"`
}

// ContainerPort maps a container port.
type ContainerPort struct {
	IP          string `json:"ip,omitempty"`
	PrivatePort int    `json:"privatePort"`
	PublicPort  int    `json:"publicPort,omitempty"`
	Type        string `json:"type"`
}

// DockerSummary holds summary counts of containers by state.
type DockerSummary struct {
	Total   int `json:"total"`
	Running int `json:"running"`
	Stopped int `json:"stopped"`
	Paused  int `json:"paused"`
}

// ImageInfo holds information about a Docker image.
type ImageInfo struct {
	ID      string   `json:"id"`
	Tags    []string `json:"tags"`
	Size    int64    `json:"size"`
	Created int64    `json:"created"`
}

// DockerSnapshot holds Docker container and image information.
type DockerSnapshot struct {
	Available   bool            `json:"available"`
	Version     string          `json:"version,omitempty"`
	ImagesTotal int             `json:"imagesTotal"`
	Summary     DockerSummary   `json:"summary"`
	Containers  []ContainerInfo `json:"containers"`
	Images      []ImageInfo     `json:"images"`
	Error       string          `json:"error,omitempty"`
}

// DockerCollector communicates with the Docker Engine API via Unix socket.
type DockerCollector struct {
	socketPath    string
	client        *http.Client
	apiVersion    string // e.g. "1.44"
	dockerVersion string // e.g. "29.1.3"
}

// NewDockerCollector creates a Docker collector that connects to the given socket.
func NewDockerCollector(socketPath string) *DockerCollector {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.DialTimeout("unix", socketPath, 5*time.Second)
		},
	}

	dc := &DockerCollector{
		socketPath: socketPath,
		client: &http.Client{
			Transport: transport,
			Timeout:   10 * time.Second,
		},
		apiVersion: "1.44", // safe default
	}

	// Auto-detect API version and Docker version from daemon
	if apiVer, dockerVer, err := dc.detectVersions(); err == nil {
		if apiVer != "" {
			dc.apiVersion = apiVer
		}
		dc.dockerVersion = dockerVer
	}

	return dc
}

// detectVersions queries the Docker daemon for its API and Docker versions.
func (c *DockerCollector) detectVersions() (apiVersion, dockerVersion string, err error) {
	resp, err := c.client.Get("http://localhost/version")
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var info struct {
		APIVersion string `json:"ApiVersion"`
		Version    string `json:"Version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", "", err
	}
	return info.APIVersion, info.Version, nil
}

// apiURL builds a Docker API URL with the detected version prefix.
func (c *DockerCollector) apiURL(path string) string {
	return fmt.Sprintf("http://localhost/v%s%s", c.apiVersion, path)
}

// listImages returns Docker image information.
func (c *DockerCollector) listImages() []ImageInfo {
	resp, err := c.client.Get(c.apiURL("/images/json"))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var raw []struct {
		ID       string   `json:"Id"`
		RepoTags []string `json:"RepoTags"`
		Size     int64    `json:"Size"`
		Created  int64    `json:"Created"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil
	}

	images := make([]ImageInfo, 0, len(raw))
	for _, r := range raw {
		tags := r.RepoTags
		if tags == nil {
			tags = []string{}
		}
		images = append(images, ImageInfo{
			ID:      r.ID,
			Tags:    tags,
			Size:    r.Size,
			Created: r.Created,
		})
	}
	return images
}

// Collect lists all containers and gathers stats for running ones.
func (c *DockerCollector) Collect() *DockerSnapshot {
	snap := &DockerSnapshot{
		Containers: []ContainerInfo{},
	}

	// List all containers
	containers, err := c.listContainers()
	if err != nil {
		snap.Available = false
		snap.Error = err.Error()
		return snap
	}

	snap.Available = true
	snap.Version = c.dockerVersion
	snap.Images = c.listImages()
	if snap.Images == nil {
		snap.Images = []ImageInfo{}
	}
	snap.ImagesTotal = len(snap.Images)

	for _, container := range containers {
		info := ContainerInfo{
			ID:      container.ID,
			Image:   container.Image,
			State:   container.State,
			Status:  container.Status,
			Created: container.Created,
			Labels:  container.Labels,
		}

		// Container name (strip leading /)
		if len(container.Names) > 0 {
			info.Name = strings.TrimPrefix(container.Names[0], "/")
		}

		// Map ports
		for _, p := range container.Ports {
			info.Ports = append(info.Ports, ContainerPort{
				IP:          p.IP,
				PrivatePort: p.PrivatePort,
				PublicPort:  p.PublicPort,
				Type:        p.Type,
			})
		}
		if info.Ports == nil {
			info.Ports = []ContainerPort{}
		}

		// Fetch stats for running containers
		if container.State == "running" {
			stats, err := c.getContainerStats(container.ID)
			if err == nil {
				info.CPUPercent = calculateDockerCPUPercent(stats)
				info.MemUsage = stats.MemoryStats.Usage
				info.MemLimit = stats.MemoryStats.Limit
				if info.MemLimit > 0 {
					info.MemPercent = round2(float64(info.MemUsage) / float64(info.MemLimit) * 100)
				}
				info.NetRx, info.NetTx = calculateDockerNetworkIO(stats)
			}
		}

		// Update summary
		snap.Summary.Total++
		switch container.State {
		case "running":
			snap.Summary.Running++
		case "paused":
			snap.Summary.Paused++
		default:
			snap.Summary.Stopped++
		}

		snap.Containers = append(snap.Containers, info)
	}

	return snap
}

// dockerContainer is the JSON structure from Docker's /containers/json endpoint.
type dockerContainer struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
	Labels  map[string]string `json:"Labels"`
	Ports   []struct {
		IP          string `json:"IP"`
		PrivatePort int    `json:"PrivatePort"`
		PublicPort  int    `json:"PublicPort"`
		Type        string `json:"Type"`
	} `json:"Ports"`
}

// listContainers calls GET /containers/json?all=true on the Docker socket.
func (c *DockerCollector) listContainers() ([]dockerContainer, error) {
	resp, err := c.client.Get(c.apiURL("/containers/json?all=true"))
	if err != nil {
		return nil, fmt.Errorf("docker API unavailable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker API returned status %d: %s", resp.StatusCode, string(body))
	}

	var containers []dockerContainer
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return nil, fmt.Errorf("decode container list: %w", err)
	}

	return containers, nil
}

// dockerStats is a subset of Docker's container stats response.
type dockerStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     int    `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     int    `json:"online_cpus"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes uint64 `json:"rx_bytes"`
		TxBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
}

// getContainerStats fetches one-shot stats for a container.
func (c *DockerCollector) getContainerStats(containerID string) (*dockerStats, error) {
	url := c.apiURL(fmt.Sprintf("/containers/%s/stats?stream=false&one-shot=true", containerID))
	resp, err := c.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("get container stats: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("container stats returned status %d", resp.StatusCode)
	}

	var stats dockerStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("decode container stats: %w", err)
	}

	return &stats, nil
}

// calculateDockerCPUPercent calculates CPU usage percentage from Docker stats.
func calculateDockerCPUPercent(stats *dockerStats) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage - stats.PreCPUStats.SystemCPUUsage)

	if systemDelta <= 0 || cpuDelta <= 0 {
		return 0
	}

	cpuCount := stats.CPUStats.OnlineCPUs
	if cpuCount == 0 {
		cpuCount = 1
	}

	return round2((cpuDelta / systemDelta) * float64(cpuCount) * 100)
}

// ContainerAction performs an action (start/stop/restart) on a container.
func (c *DockerCollector) ContainerAction(containerID, action string) error {
	var endpoint string
	switch action {
	case "start":
		endpoint = c.apiURL(fmt.Sprintf("/containers/%s/start", containerID))
	case "stop":
		endpoint = c.apiURL(fmt.Sprintf("/containers/%s/stop", containerID))
	case "restart":
		endpoint = c.apiURL(fmt.Sprintf("/containers/%s/restart", containerID))
	default:
		return fmt.Errorf("unsupported action: %s", action)
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("docker API: %w", err)
	}
	defer resp.Body.Close()

	// 204 = success, 304 = already in desired state (both OK)
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotModified {
		return nil
	}

	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("docker API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// calculateDockerNetworkIO sums network I/O across all interfaces.
func calculateDockerNetworkIO(stats *dockerStats) (rx, tx uint64) {
	for _, net := range stats.Networks {
		rx += net.RxBytes
		tx += net.TxBytes
	}
	return rx, tx
}

// ContainerLogs fetches the last N lines of a container's logs.
func (c *DockerCollector) ContainerLogs(containerID string, tail int) (string, error) {
	endpoint := c.apiURL(fmt.Sprintf("/containers/%s/logs?stdout=true&stderr=true&tail=%d&timestamps=false",
		containerID, tail))

	resp, err := c.client.Get(endpoint)
	if err != nil {
		return "", fmt.Errorf("get container logs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("docker API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// Docker log stream has 8-byte header per frame:
	// [stream_type(1)][0][0][0][size(4)][payload(size)]
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read logs: %w", err)
	}

	return stripDockerLogHeaders(raw), nil
}

// stripDockerLogHeaders removes the 8-byte Docker multiplexed stream headers.
func stripDockerLogHeaders(data []byte) string {
	var buf bytes.Buffer
	for len(data) >= 8 {
		size := binary.BigEndian.Uint32(data[4:8])
		data = data[8:]
		if int(size) > len(data) {
			size = uint32(len(data))
		}
		buf.Write(data[:size])
		data = data[size:]
	}
	if buf.Len() == 0 {
		return string(data) // fallback: may not have headers (TTY mode)
	}
	return buf.String()
}

// PullImage pulls a Docker image by name:tag and returns a status summary.
func (c *DockerCollector) PullImage(image, tag string) (string, error) {
	ref := image
	if tag != "" {
		ref = image + ":" + tag
	}
	endpoint := c.apiURL(fmt.Sprintf("/images/create?fromImage=%s", url.QueryEscape(ref)))

	req, err := http.NewRequest(http.MethodPost, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	// Use a longer timeout for pulls
	pullClient := &http.Client{
		Transport: c.client.Transport,
		Timeout:   5 * time.Minute,
	}
	resp, err := pullClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("pull image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("docker API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// Read the streaming JSON progress and extract the final status
	var lastStatus string
	decoder := json.NewDecoder(resp.Body)
	for decoder.More() {
		var progress struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		}
		if err := decoder.Decode(&progress); err != nil {
			break
		}
		if progress.Error != "" {
			return "", fmt.Errorf("pull error: %s", progress.Error)
		}
		if progress.Status != "" {
			lastStatus = progress.Status
		}
	}

	return fmt.Sprintf("Image %s pulled successfully. Status: %s", ref, lastStatus), nil
}

// CreateContainerOpts holds options for creating a Docker container.
type CreateContainerOpts struct {
	Name          string        `json:"name"`
	Image         string        `json:"image"`
	Env           []string      `json:"env,omitempty"`
	Ports         []PortMapping `json:"ports,omitempty"`
	Volumes       []string      `json:"volumes,omitempty"`
	RestartPolicy string        `json:"restartPolicy,omitempty"`
	Start         bool          `json:"start"`
}

// PortMapping describes a host-to-container port mapping.
type PortMapping struct {
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
}

// CreateContainer creates a Docker container and optionally starts it.
// Returns a status message with the container ID.
func (c *DockerCollector) CreateContainer(opts CreateContainerOpts) (string, error) {
	// Build Docker API request body
	exposedPorts := map[string]struct{}{}
	portBindings := map[string][]map[string]string{}

	for _, p := range opts.Ports {
		proto := p.Protocol
		if proto == "" {
			proto = "tcp"
		}
		key := fmt.Sprintf("%d/%s", p.ContainerPort, proto)
		exposedPorts[key] = struct{}{}
		portBindings[key] = []map[string]string{
			{"HostPort": fmt.Sprintf("%d", p.HostPort)},
		}
	}

	// Build volume binds
	var binds []string
	binds = append(binds, opts.Volumes...)

	restartPolicy := map[string]string{"Name": opts.RestartPolicy}

	body := map[string]any{
		"Image":        opts.Image,
		"Env":          opts.Env,
		"ExposedPorts": exposedPorts,
		"HostConfig": map[string]any{
			"PortBindings":  portBindings,
			"Binds":         binds,
			"RestartPolicy": restartPolicy,
		},
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal body: %w", err)
	}

	endpoint := c.apiURL(fmt.Sprintf("/containers/create?name=%s", url.QueryEscape(opts.Name)))
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("docker API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("docker API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var createResp struct {
		ID string `json:"Id"`
	}
	json.Unmarshal(respBody, &createResp)

	containerID := createResp.ID
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Optionally start the container
	if opts.Start {
		if err := c.ContainerAction(createResp.ID, "start"); err != nil {
			return fmt.Sprintf("Container %s created (ID: %s) but failed to start: %v", opts.Name, containerID, err), nil
		}
		return fmt.Sprintf("Container %s created and started (ID: %s)", opts.Name, containerID), nil
	}

	return fmt.Sprintf("Container %s created (ID: %s)", opts.Name, containerID), nil
}

// RemoveContainer removes a Docker container by ID or name.
func (c *DockerCollector) RemoveContainer(containerID string, force bool) error {
	forceParam := ""
	if force {
		forceParam = "?force=true"
	}
	endpoint := c.apiURL(fmt.Sprintf("/containers/%s%s", containerID, forceParam))

	req, err := http.NewRequest(http.MethodDelete, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("docker API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil
	}

	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("docker API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}
