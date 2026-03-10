package collector

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ProcessSummary holds aggregate process counts by state.
type ProcessSummary struct {
	Total    int `json:"total"`
	Running  int `json:"running"`
	Sleeping int `json:"sleeping"`
	Idle     int `json:"idle"`
	Zombie   int `json:"zombie"`
	Stopped  int `json:"stopped"`
}

// ProcessInfo holds information about a single process.
type ProcessInfo struct {
	PID        int     `json:"pid"`
	Name       string  `json:"name"`
	State      string  `json:"state"`
	PPID       int     `json:"ppid"`
	User       string  `json:"user"`
	CPUPercent float64 `json:"cpuPercent"`
	MemPercent float64 `json:"memPercent"`
	MemRSS     uint64  `json:"memRSS"`     // bytes
	MemVMS     uint64  `json:"memVMS"`      // bytes
	Threads    int     `json:"threads"`
	Command    string  `json:"command"`
}

// ProcessSnapshot holds process information for a point in time.
type ProcessSnapshot struct {
	Summary   ProcessSummary `json:"summary"`
	Processes []ProcessInfo  `json:"processes"`
}

// prevProcCPU stores previous CPU time for delta calculation.
type prevProcCPU struct {
	utime     uint64
	stime     uint64
	timestamp time.Time
}

// ProcessCollector reads /proc/[pid]/ entries.
type ProcessCollector struct {
	mu          sync.Mutex
	prevCPU     map[int]*prevProcCPU
	clkTck      float64
	totalMemory uint64
}

// NewProcessCollector creates a new Process collector.
func NewProcessCollector() *ProcessCollector {
	pc := &ProcessCollector{
		prevCPU: make(map[int]*prevProcCPU),
		clkTck:  100, // Default on most Linux systems (sysconf(_SC_CLK_TCK))
	}
	// Read total memory for mem% calculation
	memCollector := NewMemoryCollector()
	mem, err := memCollector.Collect()
	if err == nil {
		pc.totalMemory = mem.TotalBytes
	}
	return pc
}

// Collect reads all /proc/[pid] directories and returns process information.
func (c *ProcessCollector) Collect() (*ProcessSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, fmt.Errorf("read /proc: %w", err)
	}

	now := time.Now()
	snap := &ProcessSnapshot{}
	newPrevCPU := make(map[int]*prevProcCPU)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		proc, err := c.readProcess(pid, now)
		if err != nil {
			continue
		}

		// Update summary
		snap.Summary.Total++
		switch proc.State {
		case "R":
			snap.Summary.Running++
		case "S":
			snap.Summary.Sleeping++
		case "I":
			snap.Summary.Idle++
		case "Z":
			snap.Summary.Zombie++
		case "T", "t":
			snap.Summary.Stopped++
		default:
			snap.Summary.Sleeping++ // D (disk sleep) and others count as sleeping
		}

		snap.Processes = append(snap.Processes, proc.ProcessInfo)
		newPrevCPU[pid] = &prevProcCPU{
			utime:     proc.rawUtime,
			stime:     proc.rawStime,
			timestamp: now,
		}
	}

	c.prevCPU = newPrevCPU
	return snap, nil
}

// CollectSorted collects processes and returns them sorted and limited.
func (c *ProcessCollector) CollectSorted(sortBy, order string, limit int) (*ProcessSnapshot, error) {
	snap, err := c.Collect()
	if err != nil {
		return nil, err
	}

	// Sort processes
	sort.Slice(snap.Processes, func(i, j int) bool {
		var less bool
		switch sortBy {
		case "cpu":
			less = snap.Processes[i].CPUPercent < snap.Processes[j].CPUPercent
		case "memory", "mem":
			less = snap.Processes[i].MemRSS < snap.Processes[j].MemRSS
		case "pid":
			less = snap.Processes[i].PID < snap.Processes[j].PID
		case "name":
			less = snap.Processes[i].Name < snap.Processes[j].Name
		default:
			less = snap.Processes[i].CPUPercent < snap.Processes[j].CPUPercent
		}
		if order == "desc" {
			return !less
		}
		return less
	})

	// Apply limit
	if limit > 0 && limit < len(snap.Processes) {
		snap.Processes = snap.Processes[:limit]
	}

	return snap, nil
}

// internalProcessInfo extends ProcessInfo with raw values for CPU calculation.
type internalProcessInfo struct {
	ProcessInfo
	rawUtime uint64
	rawStime uint64
}

// readProcess reads information about a single process from /proc/[pid]/.
func (c *ProcessCollector) readProcess(pid int, now time.Time) (*internalProcessInfo, error) {
	procDir := filepath.Join("/proc", strconv.Itoa(pid))

	// Read /proc/[pid]/stat
	statData, err := os.ReadFile(filepath.Join(procDir, "stat"))
	if err != nil {
		return nil, err
	}

	proc := &internalProcessInfo{}
	proc.PID = pid

	// Parse stat file - the comm field is in parentheses and may contain spaces
	statStr := string(statData)
	openParen := strings.IndexByte(statStr, '(')
	closeParen := strings.LastIndexByte(statStr, ')')
	if openParen < 0 || closeParen < 0 || closeParen <= openParen {
		return nil, fmt.Errorf("malformed stat for pid %d", pid)
	}

	proc.Name = statStr[openParen+1 : closeParen]

	// Fields after the closing parenthesis
	rest := strings.Fields(statStr[closeParen+2:])
	if len(rest) < 22 {
		return nil, fmt.Errorf("too few fields in stat for pid %d", pid)
	}

	proc.State = rest[0]
	proc.PPID, _ = strconv.Atoi(rest[1])

	utime, _ := strconv.ParseUint(rest[11], 10, 64)
	stime, _ := strconv.ParseUint(rest[12], 10, 64)
	proc.rawUtime = utime
	proc.rawStime = stime

	threads, _ := strconv.Atoi(rest[17])
	proc.Threads = threads

	vsize, _ := strconv.ParseUint(rest[20], 10, 64)
	proc.MemVMS = vsize

	rss, _ := strconv.ParseUint(rest[21], 10, 64)
	pageSize := uint64(4096) // Standard page size
	proc.MemRSS = rss * pageSize

	// Calculate CPU%
	if prev, ok := c.prevCPU[pid]; ok {
		elapsed := now.Sub(prev.timestamp).Seconds()
		if elapsed > 0 {
			totalDelta := float64((utime + stime) - (prev.utime + prev.stime))
			proc.CPUPercent = round2((totalDelta / c.clkTck / elapsed) * 100)
			if proc.CPUPercent < 0 {
				proc.CPUPercent = 0
			}
		}
	}

	// Calculate memory percentage
	if c.totalMemory > 0 {
		proc.MemPercent = round2(float64(proc.MemRSS) / float64(c.totalMemory) * 100)
	}

	// Read UID from /proc/[pid]/status for user name
	proc.User = c.readProcessUser(procDir)

	// Read command line
	proc.Command = c.readCmdline(procDir)
	if proc.Command == "" {
		proc.Command = "[" + proc.Name + "]"
	}

	return proc, nil
}

// readProcessUser reads the UID from /proc/[pid]/status and resolves it.
func (c *ProcessCollector) readProcessUser(procDir string) string {
	data, err := os.ReadFile(filepath.Join(procDir, "status"))
	if err != nil {
		return ""
	}

	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				uid := fields[1]
				return resolveUID(uid)
			}
		}
	}
	return ""
}

// readCmdline reads /proc/[pid]/cmdline and formats it.
func (c *ProcessCollector) readCmdline(procDir string) string {
	data, err := os.ReadFile(filepath.Join(procDir, "cmdline"))
	if err != nil || len(data) == 0 {
		return ""
	}

	// cmdline uses null bytes as separators
	cmd := strings.ReplaceAll(string(data), "\x00", " ")
	cmd = strings.TrimSpace(cmd)

	// Truncate very long command lines
	if len(cmd) > 256 {
		cmd = cmd[:256] + "..."
	}
	return cmd
}

// resolveUID tries to map a numeric UID to a username.
func resolveUID(uid string) string {
	// Common UIDs
	switch uid {
	case "0":
		return "root"
	case "65534":
		return "nobody"
	}

	// Try /etc/passwd
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return uid
	}

	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.SplitN(line, ":", 4)
		if len(fields) >= 3 && fields[2] == uid {
			return fields[0]
		}
	}

	return uid
}
