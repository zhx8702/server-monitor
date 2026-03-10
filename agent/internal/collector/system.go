package collector

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// SystemInfo holds static system information.
type SystemInfo struct {
	Hostname       string `json:"hostname"`
	OS             string `json:"os"`
	OSVersion      string `json:"osVersion"`
	OSPrettyName   string `json:"osPrettyName"`
	Kernel         string `json:"kernel"`
	KernelVersion  string `json:"kernelVersion"`
	Arch           string `json:"arch"`
	CpuModel       string `json:"cpuModel"`
	CpuCores       int    `json:"cpuCores"`
	TotalMemory    uint64 `json:"totalMemory"`
	UptimeSeconds  int64  `json:"uptimeSeconds"`
	UptimeHuman    string `json:"uptimeHuman"`
	Virtualization string `json:"virtualization"`
	BootTime       int64  `json:"bootTime"`
}

// SystemCollector gathers static system information.
type SystemCollector struct{}

// NewSystemCollector creates a new System collector.
func NewSystemCollector() *SystemCollector {
	return &SystemCollector{}
}

// Collect gathers system information from various sources.
func (c *SystemCollector) Collect() (*SystemInfo, error) {
	info := &SystemInfo{
		Arch: runtime.GOARCH,
	}

	// Hostname
	hostname, err := os.Hostname()
	if err == nil {
		info.Hostname = hostname
	}

	// OS release info
	c.readOSRelease(info)

	// Kernel info
	c.readKernelInfo(info)

	// CPU info
	c.readCPUInfo(info)

	// Total memory from /proc/meminfo
	c.readTotalMemory(info)

	// Uptime
	c.readUptime(info)

	// Virtualization detection
	info.Virtualization = c.detectVirtualization()

	return info, nil
}

// readOSRelease parses /etc/os-release for OS identification.
func (c *SystemCollector) readOSRelease(info *SystemInfo) {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := parts[0]
		value := strings.Trim(parts[1], `"`)

		switch key {
		case "ID":
			info.OS = value
		case "VERSION_ID":
			info.OSVersion = value
		case "PRETTY_NAME":
			info.OSPrettyName = value
		}
	}
}

// readKernelInfo reads kernel version from /proc/version.
func (c *SystemCollector) readKernelInfo(info *SystemInfo) {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return
	}
	info.Kernel = "Linux"
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		info.KernelVersion = fields[2]
	}

	// Also try uname for architecture
	out, err := exec.Command("uname", "-m").Output()
	if err == nil {
		info.Arch = strings.TrimSpace(string(out))
	}
}

// readCPUInfo extracts CPU model and core count from /proc/cpuinfo.
func (c *SystemCollector) readCPUInfo(info *SystemInfo) {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return
	}
	defer f.Close()

	cores := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 && info.CpuModel == "" {
				info.CpuModel = strings.TrimSpace(parts[1])
			}
		}
		if strings.HasPrefix(line, "processor") {
			cores++
		}
	}
	info.CpuCores = cores
}

// readTotalMemory reads total memory from /proc/meminfo.
func (c *SystemCollector) readTotalMemory(info *SystemInfo) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if val, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					info.TotalMemory = val * 1024 // kB to bytes
				}
			}
			return
		}
	}
}

// readUptime reads system uptime from /proc/uptime.
func (c *SystemCollector) readUptime(info *SystemInfo) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return
	}

	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return
	}

	uptimeFloat, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return
	}

	info.UptimeSeconds = int64(uptimeFloat)
	info.BootTime = time.Now().Unix() - info.UptimeSeconds

	// Human-readable uptime
	d := time.Duration(int64(uptimeFloat)) * time.Second
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		info.UptimeHuman = fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	} else if hours > 0 {
		info.UptimeHuman = fmt.Sprintf("%dh %dm", hours, minutes)
	} else {
		info.UptimeHuman = fmt.Sprintf("%dm", minutes)
	}
}

// detectVirtualization tries to detect if the system is running in a virtual environment.
func (c *SystemCollector) detectVirtualization() string {
	// Try systemd-detect-virt first
	out, err := exec.Command("systemd-detect-virt").Output()
	if err == nil {
		result := strings.TrimSpace(string(out))
		if result != "none" && result != "" {
			return result
		}
		return "none"
	}

	// Check if running in Docker
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "docker"
	}

	// Check cgroup for docker/lxc
	data, err := os.ReadFile("/proc/1/cgroup")
	if err == nil {
		content := string(data)
		if strings.Contains(content, "docker") {
			return "docker"
		}
		if strings.Contains(content, "lxc") {
			return "lxc"
		}
	}

	// Check DMI for hypervisor
	data, err = os.ReadFile("/sys/class/dmi/id/product_name")
	if err == nil {
		product := strings.TrimSpace(strings.ToLower(string(data)))
		switch {
		case strings.Contains(product, "virtualbox"):
			return "virtualbox"
		case strings.Contains(product, "vmware"):
			return "vmware"
		case strings.Contains(product, "kvm"):
			return "kvm"
		case strings.Contains(product, "qemu"):
			return "qemu"
		case strings.Contains(product, "hyper-v"):
			return "hyperv"
		}
	}

	return "none"
}
