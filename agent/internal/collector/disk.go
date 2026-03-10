package collector

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Filesystem holds disk usage information for a mounted filesystem.
type Filesystem struct {
	Device     string  `json:"device"`
	Type       string  `json:"type"`
	MountPoint string  `json:"mountPoint"`
	TotalBytes uint64  `json:"totalBytes"`
	UsedBytes  uint64  `json:"usedBytes"`
	FreeBytes  uint64  `json:"freeBytes"`
	UsedPct    float64 `json:"usedPct"`
}

// DiskIO holds I/O statistics for a block device.
type DiskIO struct {
	Device         string  `json:"device"`
	ReadBytesSec   float64 `json:"readBytesSec"`
	WriteBytesSec  float64 `json:"writeBytesSec"`
	ReadIOPS       float64 `json:"readIOPS"`
	WriteIOPS      float64 `json:"writeIOPS"`
	IoInProgress   uint64  `json:"ioInProgress"`
	IoUtilPercent  float64 `json:"ioUtilPercent"`
}

// prevDiskStats stores previous readings for rate calculation.
type prevDiskStats struct {
	sectorsRead    uint64
	sectorsWritten uint64
	readsComplete  uint64
	writesComplete uint64
	ioTimeMs       uint64
	timestamp      time.Time
}

// DiskSnapshot holds filesystem and I/O information.
type DiskSnapshot struct {
	Filesystems []Filesystem `json:"filesystems"`
	IO          []DiskIO     `json:"io"`
}

// DiskCollector collects disk usage and I/O statistics.
type DiskCollector struct {
	mu   sync.Mutex
	prev map[string]*prevDiskStats
}

// NewDiskCollector creates a new Disk collector.
func NewDiskCollector() *DiskCollector {
	return &DiskCollector{
		prev: make(map[string]*prevDiskStats),
	}
}

// Collect runs `df -T` and reads /proc/diskstats for disk information.
func (c *DiskCollector) Collect() (*DiskSnapshot, error) {
	snap := &DiskSnapshot{}

	// Collect filesystem usage via df -T
	filesystems, err := c.collectFilesystems()
	if err != nil {
		// Non-fatal: we can still return I/O stats
		snap.Filesystems = []Filesystem{}
	} else {
		snap.Filesystems = filesystems
	}

	// Collect I/O stats from /proc/diskstats
	ioStats, err := c.collectDiskIO()
	if err != nil {
		snap.IO = []DiskIO{}
	} else {
		snap.IO = ioStats
	}

	return snap, nil
}

// collectFilesystems runs df -T and parses the output.
func (c *DiskCollector) collectFilesystems() ([]Filesystem, error) {
	cmd := exec.Command("df", "-T", "-B1", "--exclude-type=tmpfs", "--exclude-type=devtmpfs", "--exclude-type=squashfs", "--exclude-type=overlay")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("run df: %w", err)
	}

	var filesystems []Filesystem
	lines := strings.Split(string(out), "\n")
	for i, line := range lines {
		// Skip header
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}

		device := fields[0]
		fsType := fields[1]
		mountPoint := fields[6]

		// Skip pseudo-filesystems
		if !strings.HasPrefix(device, "/") {
			continue
		}

		totalBytes, _ := strconv.ParseUint(fields[2], 10, 64)
		usedBytes, _ := strconv.ParseUint(fields[3], 10, 64)
		freeBytes, _ := strconv.ParseUint(fields[4], 10, 64)

		var usedPct float64
		pctStr := strings.TrimSuffix(fields[5], "%")
		if v, err := strconv.ParseFloat(pctStr, 64); err == nil {
			usedPct = v
		}

		filesystems = append(filesystems, Filesystem{
			Device:     device,
			Type:       fsType,
			MountPoint: mountPoint,
			TotalBytes: totalBytes,
			UsedBytes:  usedBytes,
			FreeBytes:  freeBytes,
			UsedPct:    usedPct,
		})
	}

	return filesystems, nil
}

// collectDiskIO reads /proc/diskstats for I/O statistics and calculates per-second rates.
func (c *DiskCollector) collectDiskIO() ([]DiskIO, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	f, err := os.Open("/proc/diskstats")
	if err != nil {
		return nil, fmt.Errorf("open /proc/diskstats: %w", err)
	}
	defer f.Close()

	now := time.Now()
	var ioStats []DiskIO
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}

		devName := fields[2]

		// Skip partition entries (e.g., sda1) and keep only whole devices
		// Also include device-mapper, md, nvme devices
		if isPartition(devName) {
			continue
		}

		readsComplete, _ := strconv.ParseUint(fields[3], 10, 64)
		sectorsRead, _ := strconv.ParseUint(fields[5], 10, 64)
		writesComplete, _ := strconv.ParseUint(fields[7], 10, 64)
		sectorsWritten, _ := strconv.ParseUint(fields[9], 10, 64)
		ioInProgress, _ := strconv.ParseUint(fields[11], 10, 64)
		ioTimeMs, _ := strconv.ParseUint(fields[12], 10, 64)

		// Skip devices with no activity
		if readsComplete == 0 && writesComplete == 0 {
			continue
		}

		io := DiskIO{
			Device:       devName,
			IoInProgress: ioInProgress,
		}

		// Calculate rates if we have a previous reading
		if prev, ok := c.prev[devName]; ok {
			elapsed := now.Sub(prev.timestamp).Seconds()
			if elapsed > 0 {
				io.ReadBytesSec = round2(float64(sectorsRead-prev.sectorsRead) * 512 / elapsed)
				io.WriteBytesSec = round2(float64(sectorsWritten-prev.sectorsWritten) * 512 / elapsed)
				io.ReadIOPS = round2(float64(readsComplete-prev.readsComplete) / elapsed)
				io.WriteIOPS = round2(float64(writesComplete-prev.writesComplete) / elapsed)
				// IO utilization: ioTimeMs is in milliseconds, elapsed is in seconds
				deltaIoMs := float64(ioTimeMs - prev.ioTimeMs)
				io.IoUtilPercent = round2(deltaIoMs / (elapsed * 1000) * 100)

				// Handle counter wraparound
				if io.ReadBytesSec < 0 {
					io.ReadBytesSec = 0
				}
				if io.WriteBytesSec < 0 {
					io.WriteBytesSec = 0
				}
				if io.ReadIOPS < 0 {
					io.ReadIOPS = 0
				}
				if io.WriteIOPS < 0 {
					io.WriteIOPS = 0
				}
				if io.IoUtilPercent < 0 || io.IoUtilPercent > 100 {
					io.IoUtilPercent = 0
				}
			}
		}

		// Store current as previous for next collection
		c.prev[devName] = &prevDiskStats{
			sectorsRead:    sectorsRead,
			sectorsWritten: sectorsWritten,
			readsComplete:  readsComplete,
			writesComplete: writesComplete,
			ioTimeMs:       ioTimeMs,
			timestamp:      now,
		}

		ioStats = append(ioStats, io)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading /proc/diskstats: %w", err)
	}

	return ioStats, nil
}

// isPartition determines if a device name is a partition rather than a whole disk.
func isPartition(name string) bool {
	// Skip loop devices
	if strings.HasPrefix(name, "loop") {
		return true
	}
	// NVMe: nvme0n1 is a disk, nvme0n1p1 is a partition
	if strings.HasPrefix(name, "nvme") {
		return strings.Contains(name, "p") && len(name) > strings.LastIndex(name, "p")+1
	}
	// Standard: sda is a disk, sda1 is a partition
	if len(name) > 0 {
		last := name[len(name)-1]
		if last >= '0' && last <= '9' {
			// Check if it's like sda1 (disk letter + number)
			for i := len(name) - 1; i >= 0; i-- {
				if name[i] < '0' || name[i] > '9' {
					// If the character before the trailing digits is a letter, it's a partition
					if name[i] >= 'a' && name[i] <= 'z' {
						// Check if there's a disk name before this
						prefix := name[:i+1]
						if strings.HasPrefix(prefix, "sd") || strings.HasPrefix(prefix, "hd") || strings.HasPrefix(prefix, "vd") || strings.HasPrefix(prefix, "xvd") {
							return true
						}
					}
					break
				}
			}
		}
	}
	return false
}
