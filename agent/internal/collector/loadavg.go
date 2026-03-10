package collector

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// LoadAvg holds system load averages.
type LoadAvg struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}

// LoadAvgCollector reads /proc/loadavg.
type LoadAvgCollector struct{}

// NewLoadAvgCollector creates a new LoadAvg collector.
func NewLoadAvgCollector() *LoadAvgCollector {
	return &LoadAvgCollector{}
}

// Collect reads /proc/loadavg and returns the current load averages.
func (c *LoadAvgCollector) Collect() (*LoadAvg, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil, fmt.Errorf("read /proc/loadavg: %w", err)
	}

	fields := strings.Fields(strings.TrimSpace(string(data)))
	if len(fields) < 3 {
		return nil, fmt.Errorf("malformed /proc/loadavg: expected at least 3 fields, got %d", len(fields))
	}

	load1, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return nil, fmt.Errorf("parse load1: %w", err)
	}

	load5, err := strconv.ParseFloat(fields[1], 64)
	if err != nil {
		return nil, fmt.Errorf("parse load5: %w", err)
	}

	load15, err := strconv.ParseFloat(fields[2], 64)
	if err != nil {
		return nil, fmt.Errorf("parse load15: %w", err)
	}

	return &LoadAvg{
		Load1:  load1,
		Load5:  load5,
		Load15: load15,
	}, nil
}
