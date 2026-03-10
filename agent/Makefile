BINARY_NAME=server-monitor-agent
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME = $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

VERSION_PKG = github.com/server-monitor/agent/internal/version
LDFLAGS = -s -w \
	-X '$(VERSION_PKG).Version=$(VERSION)' \
	-X '$(VERSION_PKG).Commit=$(COMMIT)' \
	-X '$(VERSION_PKG).BuildTime=$(BUILD_TIME)'

.PHONY: all build linux-amd64 linux-arm64 clean help

all: linux-amd64 linux-arm64

build: linux-amd64

linux-amd64:
	@echo "Building for linux/amd64..."
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
		-ldflags "$(LDFLAGS)" \
		-o dist/$(BINARY_NAME)-linux-amd64 \
		./cmd/agent

linux-arm64:
	@echo "Building for linux/arm64..."
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build \
		-ldflags "$(LDFLAGS)" \
		-o dist/$(BINARY_NAME)-linux-arm64 \
		./cmd/agent

clean:
	@echo "Cleaning..."
	rm -rf dist/

help:
	@echo "Available targets:"
	@echo "  all          - Build for all platforms (default)"
	@echo "  build        - Build for linux/amd64"
	@echo "  linux-amd64  - Build for linux/amd64"
	@echo "  linux-arm64  - Build for linux/arm64"
	@echo "  clean        - Remove build artifacts"
