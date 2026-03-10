package history

import (
	"sync"
	"time"
)

// Entry wraps a value with a timestamp for time-based queries.
type Entry[T any] struct {
	Timestamp time.Time `json:"timestamp"`
	Data      T         `json:"data"`
}

// RingBuffer is a thread-safe, fixed-capacity circular buffer.
// Capacity is calculated from historyDuration / collectInterval.
type RingBuffer[T any] struct {
	mu       sync.RWMutex
	entries  []Entry[T]
	capacity int
	head     int // next write position
	count    int // number of entries stored
}

// NewRingBuffer creates a ring buffer with capacity = historyDuration / collectInterval.
func NewRingBuffer[T any](historyDuration, collectInterval int) *RingBuffer[T] {
	capacity := historyDuration / collectInterval
	if capacity < 1 {
		capacity = 1
	}
	return &RingBuffer[T]{
		entries:  make([]Entry[T], capacity),
		capacity: capacity,
	}
}

// Push adds a new entry to the buffer, overwriting the oldest if full.
func (rb *RingBuffer[T]) Push(data T) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.entries[rb.head] = Entry[T]{
		Timestamp: time.Now(),
		Data:      data,
	}
	rb.head = (rb.head + 1) % rb.capacity
	if rb.count < rb.capacity {
		rb.count++
	}
}

// GetAll returns all entries in chronological order (oldest first).
func (rb *RingBuffer[T]) GetAll() []Entry[T] {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.count == 0 {
		return nil
	}

	result := make([]Entry[T], rb.count)
	start := (rb.head - rb.count + rb.capacity) % rb.capacity
	for i := 0; i < rb.count; i++ {
		idx := (start + i) % rb.capacity
		result[i] = rb.entries[idx]
	}
	return result
}

// GetSince returns all entries with timestamps after the given time, in chronological order.
func (rb *RingBuffer[T]) GetSince(since time.Time) []Entry[T] {
	all := rb.GetAll()
	if all == nil {
		return nil
	}

	// Binary search for the first entry >= since
	lo, hi := 0, len(all)
	for lo < hi {
		mid := (lo + hi) / 2
		if all[mid].Timestamp.Before(since) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}

	if lo >= len(all) {
		return nil
	}
	result := make([]Entry[T], len(all)-lo)
	copy(result, all[lo:])
	return result
}

// Latest returns the most recent entry, or the zero value if empty.
func (rb *RingBuffer[T]) Latest() (Entry[T], bool) {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.count == 0 {
		var zero Entry[T]
		return zero, false
	}

	idx := (rb.head - 1 + rb.capacity) % rb.capacity
	return rb.entries[idx], true
}
