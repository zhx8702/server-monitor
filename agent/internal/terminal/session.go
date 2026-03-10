package terminal

import (
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// Session represents a single PTY terminal session.
type Session struct {
	ID     string
	cmd    *exec.Cmd
	ptmx   *os.File
	mu     sync.Mutex
	closed bool
}

// NewSession creates a new PTY session running the given command.
func NewSession(id string, command string, args []string, env []string) (*Session, error) {
	cmd := exec.Command(command, args...)
	cmd.Env = append(os.Environ(), env...)

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	return &Session{
		ID:   id,
		cmd:  cmd,
		ptmx: ptmx,
	}, nil
}

// Read reads from the PTY (terminal output).
func (s *Session) Read(p []byte) (int, error) {
	return s.ptmx.Read(p)
}

// Write writes to the PTY (terminal input).
func (s *Session) Write(p []byte) (int, error) {
	return s.ptmx.Write(p)
}

// Resize resizes the PTY window.
func (s *Session) Resize(rows, cols uint16) error {
	return pty.Setsize(s.ptmx, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

// Close terminates the session.
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true

	_ = s.ptmx.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	_ = s.cmd.Wait()
	return nil
}
