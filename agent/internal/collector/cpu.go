package collector

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
)

// CoreUsage holds usage percentages for a single CPU core.
type CoreUsage struct {
	Core          int     `json:"core"`
	TotalPercent  float64 `json:"totalPercent"`
	UserPercent   float64 `json:"userPercent"`
	SystemPercent float64 `json:"systemPercent"`
	IdlePercent   float64 `json:"idlePercent"`
	IowaitPercent float64 `json:"iowaitPercent"`
}

// CpuSnapshot holds a point-in-time CPU usage snapshot.
type CpuSnapshot struct {
	TotalPercent  float64     `json:"totalPercent"`
	UserPercent   float64     `json:"userPercent"`
	SystemPercent float64     `json:"systemPercent"`
	IdlePercent   float64     `json:"idlePercent"`
	IowaitPercent float64     `json:"iowaitPercent"`
	CoreCount     int         `json:"coreCount"`
	PerCore       []CoreUsage `json:"perCore"`
}

// cpuTimes stores raw jiffies read from /proc/stat.
type cpuTimes struct {
	user    uint64
	nice    uint64
	system  uint64
	idle    uint64
	iowait  uint64
	irq     uint64
	softirq uint64
	steal   uint64
}

func (c cpuTimes) total() uint64 {
	return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal
}

// CpuCollector reads /proc/stat and computes CPU usage deltas.
type CpuCollector struct {
	mu       sync.Mutex
	prevAll  *cpuTimes
	prevCore map[int]*cpuTimes
}

// NewCpuCollector creates a new CPU collector with no previous state.
func NewCpuCollector() *CpuCollector {
	return &CpuCollector{
		prevCore: make(map[int]*cpuTimes),
	}
}

// Collect reads /proc/stat and returns the current CPU usage snapshot.
func (c *CpuCollector) Collect() (*CpuSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	f, err := os.Open("/proc/stat")
	if err != nil {
		return nil, fmt.Errorf("open /proc/stat: %w", err)
	}
	defer f.Close()

	var allCurrent *cpuTimes
	coreCurrent := make(map[int]*cpuTimes)

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "cpu ") {
			t, err := parseCpuLine(line)
			if err != nil {
				return nil, err
			}
			allCurrent = t
		} else if strings.HasPrefix(line, "cpu") {
			// Lines like "cpu0", "cpu1", etc.
			fields := strings.Fields(line)
			if len(fields) < 1 {
				continue
			}
			numStr := strings.TrimPrefix(fields[0], "cpu")
			coreNum, err := strconv.Atoi(numStr)
			if err != nil {
				continue
			}
			t, err := parseCpuLine(line)
			if err != nil {
				continue
			}
			coreCurrent[coreNum] = t
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading /proc/stat: %w", err)
	}

	if allCurrent == nil {
		return nil, fmt.Errorf("no aggregate cpu line found in /proc/stat")
	}

	snap := &CpuSnapshot{
		CoreCount: len(coreCurrent),
	}

	// Calculate aggregate CPU percentages
	if c.prevAll != nil {
		snap.TotalPercent, snap.UserPercent, snap.SystemPercent, snap.IdlePercent, snap.IowaitPercent =
			calcPercent(c.prevAll, allCurrent)
	}

	// Calculate per-core percentages
	snap.PerCore = make([]CoreUsage, 0, len(coreCurrent))
	for i := 0; i < len(coreCurrent); i++ {
		cur, ok := coreCurrent[i]
		if !ok {
			continue
		}
		cu := CoreUsage{Core: i}
		if prev, ok := c.prevCore[i]; ok {
			cu.TotalPercent, cu.UserPercent, cu.SystemPercent, cu.IdlePercent, cu.IowaitPercent =
				calcPercent(prev, cur)
		}
		snap.PerCore = append(snap.PerCore, cu)
	}

	// Save current as previous for next delta
	c.prevAll = allCurrent
	c.prevCore = coreCurrent

	return snap, nil
}

// parseCpuLine parses a "cpu" or "cpuN" line from /proc/stat.
func parseCpuLine(line string) (*cpuTimes, error) {
	fields := strings.Fields(line)
	if len(fields) < 8 {
		return nil, fmt.Errorf("malformed cpu line: %q", line)
	}

	vals := make([]uint64, 8)
	for i := 0; i < 8; i++ {
		v, err := strconv.ParseUint(fields[i+1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse field %d of cpu line: %w", i+1, err)
		}
		vals[i] = v
	}

	return &cpuTimes{
		user:    vals[0],
		nice:    vals[1],
		system:  vals[2],
		idle:    vals[3],
		iowait:  vals[4],
		irq:     vals[5],
		softirq: vals[6],
		steal:   vals[7],
	}, nil
}

// calcPercent computes usage percentages from two snapshots.
func calcPercent(prev, cur *cpuTimes) (total, user, system, idle, iowait float64) {
	totalDelta := float64(cur.total() - prev.total())
	if totalDelta == 0 {
		return 0, 0, 0, 100, 0
	}

	userDelta := float64((cur.user + cur.nice) - (prev.user + prev.nice))
	systemDelta := float64((cur.system + cur.irq + cur.softirq) - (prev.system + prev.irq + prev.softirq))
	idleDelta := float64(cur.idle - prev.idle)
	iowaitDelta := float64(cur.iowait - prev.iowait)

	user = (userDelta / totalDelta) * 100
	system = (systemDelta / totalDelta) * 100
	idle = (idleDelta / totalDelta) * 100
	iowait = (iowaitDelta / totalDelta) * 100
	total = 100 - idle

	return round2(total), round2(user), round2(system), round2(idle), round2(iowait)
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
