package terminal

import (
	"fmt"
	"sync"
)

// Manager manages multiple concurrent terminal sessions.
type Manager struct {
	sessions    map[string]*Session
	mu          sync.RWMutex
	maxSessions int
}

// NewManager creates a manager with a maximum session limit.
func NewManager(maxSessions int) *Manager {
	if maxSessions <= 0 {
		maxSessions = 5
	}
	return &Manager{
		sessions:    make(map[string]*Session),
		maxSessions: maxSessions,
	}
}

// Create creates a new terminal session.
func (m *Manager) Create(id, command string, args, env []string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.sessions) >= m.maxSessions {
		return nil, fmt.Errorf("max sessions (%d) reached", m.maxSessions)
	}

	sess, err := NewSession(id, command, args, env)
	if err != nil {
		return nil, err
	}
	m.sessions[id] = sess
	return sess, nil
}

// Get returns a session by ID.
func (m *Manager) Get(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

// Remove closes and removes a session.
func (m *Manager) Remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sess, ok := m.sessions[id]; ok {
		sess.Close()
		delete(m.sessions, id)
	}
}

// List returns all active session IDs.
func (m *Manager) List() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}

// CloseAll closes and removes all sessions.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, sess := range m.sessions {
		sess.Close()
		delete(m.sessions, id)
	}
}
