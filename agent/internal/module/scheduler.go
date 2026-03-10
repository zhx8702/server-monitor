package module

import (
	"context"
	"log"
	"time"
)

// Scheduler manages periodic collection for all PeriodicModule instances.
type Scheduler struct {
	modules  []PeriodicModule
	interval time.Duration // global default interval
}

// NewScheduler creates a scheduler from the list of modules.
// Only modules implementing PeriodicModule are included.
func NewScheduler(defaultInterval time.Duration, modules []Module) *Scheduler {
	var periodic []PeriodicModule
	for _, m := range modules {
		if pm, ok := m.(PeriodicModule); ok {
			periodic = append(periodic, pm)
		}
	}
	return &Scheduler{
		modules:  periodic,
		interval: defaultInterval,
	}
}

// Run starts periodic collection. Blocks until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	if len(s.modules) == 0 {
		return
	}

	// Collect once immediately to seed initial data
	s.collectAll()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.collectAll()
		}
	}
}

func (s *Scheduler) collectAll() {
	for _, m := range s.modules {
		if err := m.Collect(); err != nil {
			log.Printf("%s collect error: %v", m.Name(), err)
		}
	}
}
