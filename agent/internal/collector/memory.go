package collector

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// MemorySnapshot holds memory and swap usage information.
type MemorySnapshot struct {
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	FreeBytes      uint64  `json:"freeBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	BuffersBytes   uint64  `json:"buffersBytes"`
	CachedBytes    uint64  `json:"cachedBytes"`
	UsagePercent   float64 `json:"usagePercent"`

	SwapTotalBytes   uint64  `json:"swapTotalBytes"`
	SwapUsedBytes    uint64  `json:"swapUsedBytes"`
	SwapFreeBytes    uint64  `json:"swapFreeBytes"`
	SwapUsagePercent float64 `json:"swapUsagePercent"`
}

// MemoryCollector reads /proc/meminfo.
type MemoryCollector struct{}

// NewMemoryCollector creates a new Memory collector.
func NewMemoryCollector() *MemoryCollector {
	return &MemoryCollector{}
}

// Collect reads /proc/meminfo and returns a MemorySnapshot.
func (c *MemoryCollector) Collect() (*MemorySnapshot, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, fmt.Errorf("open /proc/meminfo: %w", err)
	}
	defer f.Close()

	fields := make(map[string]uint64)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		valStr := strings.TrimSpace(parts[1])
		valStr = strings.TrimSuffix(valStr, " kB")
		valStr = strings.TrimSpace(valStr)

		val, err := strconv.ParseUint(valStr, 10, 64)
		if err != nil {
			continue
		}
		// Convert kB to bytes
		fields[key] = val * 1024
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading /proc/meminfo: %w", err)
	}

	total := fields["MemTotal"]
	free := fields["MemFree"]
	available := fields["MemAvailable"]
	buffers := fields["Buffers"]
	cached := fields["Cached"]
	used := total - free - buffers - cached
	if total > 0 && used > total {
		// Fallback if calculation underflows
		used = total - available
	}

	swapTotal := fields["SwapTotal"]
	swapFree := fields["SwapFree"]
	swapUsed := swapTotal - swapFree

	var usagePercent float64
	if total > 0 {
		usagePercent = round2(float64(used) / float64(total) * 100)
	}

	var swapUsagePercent float64
	if swapTotal > 0 {
		swapUsagePercent = round2(float64(swapUsed) / float64(swapTotal) * 100)
	}

	return &MemorySnapshot{
		TotalBytes:       total,
		UsedBytes:        used,
		FreeBytes:        free,
		AvailableBytes:   available,
		BuffersBytes:     buffers,
		CachedBytes:      cached,
		UsagePercent:     usagePercent,
		SwapTotalBytes:   swapTotal,
		SwapUsedBytes:    swapUsed,
		SwapFreeBytes:    swapFree,
		SwapUsagePercent: swapUsagePercent,
	}, nil
}
