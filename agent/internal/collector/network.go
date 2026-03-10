package collector

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NetworkInterface holds per-interface network statistics.
type NetworkInterface struct {
	Name         string  `json:"name"`
	RxBytes      uint64  `json:"rxBytes"`
	TxBytes      uint64  `json:"txBytes"`
	RxBytesSec   float64 `json:"rxBytesSec"`
	TxBytesSec   float64 `json:"txBytesSec"`
	RxPackets    uint64  `json:"rxPackets"`
	TxPackets    uint64  `json:"txPackets"`
	RxPacketsSec float64 `json:"rxPacketsSec"`
	TxPacketsSec float64 `json:"txPacketsSec"`
	State        string  `json:"state"`
}

// NetworkSnapshot holds network data for all interfaces.
type NetworkSnapshot struct {
	Interfaces []NetworkInterface `json:"interfaces"`
}

// prevNetStats stores previous readings for rate calculation.
type prevNetStats struct {
	rxBytes   uint64
	txBytes   uint64
	rxPackets uint64
	txPackets uint64
	timestamp time.Time
}

// NetworkCollector reads /proc/net/dev and calculates per-second rates.
type NetworkCollector struct {
	mu   sync.Mutex
	prev map[string]*prevNetStats
}

// NewNetworkCollector creates a new Network collector.
func NewNetworkCollector() *NetworkCollector {
	return &NetworkCollector{
		prev: make(map[string]*prevNetStats),
	}
}

// Collect reads /proc/net/dev and returns per-interface statistics.
func (c *NetworkCollector) Collect() (*NetworkSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return nil, fmt.Errorf("open /proc/net/dev: %w", err)
	}
	defer f.Close()

	now := time.Now()
	var interfaces []NetworkInterface

	scanner := bufio.NewScanner(f)
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		// Skip the two header lines
		if lineNum <= 2 {
			continue
		}

		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		name := strings.TrimSpace(parts[0])
		// Skip loopback
		if name == "lo" {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}

		rxBytes, _ := strconv.ParseUint(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseUint(fields[1], 10, 64)
		txBytes, _ := strconv.ParseUint(fields[8], 10, 64)
		txPackets, _ := strconv.ParseUint(fields[9], 10, 64)

		iface := NetworkInterface{
			Name:      name,
			RxBytes:   rxBytes,
			TxBytes:   txBytes,
			RxPackets: rxPackets,
			TxPackets: txPackets,
			State:     getInterfaceState(name),
		}

		// Calculate rates if we have a previous reading
		if prev, ok := c.prev[name]; ok {
			elapsed := now.Sub(prev.timestamp).Seconds()
			if elapsed > 0 {
				iface.RxBytesSec = round2(float64(rxBytes-prev.rxBytes) / elapsed)
				iface.TxBytesSec = round2(float64(txBytes-prev.txBytes) / elapsed)
				iface.RxPacketsSec = round2(float64(rxPackets-prev.rxPackets) / elapsed)
				iface.TxPacketsSec = round2(float64(txPackets-prev.txPackets) / elapsed)

				// Handle counter wraparound
				if iface.RxBytesSec < 0 {
					iface.RxBytesSec = 0
				}
				if iface.TxBytesSec < 0 {
					iface.TxBytesSec = 0
				}
				if iface.RxPacketsSec < 0 {
					iface.RxPacketsSec = 0
				}
				if iface.TxPacketsSec < 0 {
					iface.TxPacketsSec = 0
				}
			}
		}

		// Store current as previous for next collection
		c.prev[name] = &prevNetStats{
			rxBytes:   rxBytes,
			txBytes:   txBytes,
			rxPackets: rxPackets,
			txPackets: txPackets,
			timestamp: now,
		}

		interfaces = append(interfaces, iface)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading /proc/net/dev: %w", err)
	}

	return &NetworkSnapshot{
		Interfaces: interfaces,
	}, nil
}

// getInterfaceState reads the operstate of a network interface.
func getInterfaceState(name string) string {
	data, err := os.ReadFile(fmt.Sprintf("/sys/class/net/%s/operstate", name))
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(data))
}
