package ghproxy

import (
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Default proxy URLs to try (in order) when github.com is unreachable.
var defaultProxies = []string{
	"https://ghproxy.net",
	"https://mirror.ghproxy.com",
}

// Resolver resolves GitHub URLs, optionally prepending a proxy prefix.
type Resolver struct {
	proxyURL    string // explicit proxy from config/env
	mu          sync.RWMutex
	cachedProxy string
	cacheTime   time.Time
	cacheTTL    time.Duration
}

// NewResolver creates a new resolver.
// proxyURL can be empty (auto-detect) or a user-configured proxy base URL.
func NewResolver(proxyURL string) *Resolver {
	if v := os.Getenv("GITHUB_PROXY"); v != "" {
		proxyURL = v
	}
	return &Resolver{
		proxyURL: strings.TrimRight(proxyURL, "/"),
		cacheTTL: 5 * time.Minute,
	}
}

// Resolve rewrites a GitHub URL through a proxy if github.com is unreachable.
// Works for both api.github.com and github.com URLs.
func (r *Resolver) Resolve(originalURL string) string {
	proxy := r.getProxy()
	if proxy == "" {
		return originalURL
	}
	return proxy + "/" + originalURL
}

func (r *Resolver) getProxy() string {
	// Explicit proxy always wins
	if r.proxyURL != "" {
		return r.proxyURL
	}

	// Check cache
	r.mu.RLock()
	if !r.cacheTime.IsZero() && time.Since(r.cacheTime) < r.cacheTTL {
		proxy := r.cachedProxy
		r.mu.RUnlock()
		return proxy
	}
	r.mu.RUnlock()

	// Test direct GitHub connectivity
	if testGitHub() {
		r.setCache("")
		return ""
	}

	// GitHub unreachable — try proxies
	for _, proxy := range defaultProxies {
		if testProxy(proxy) {
			log.Printf("ghproxy: github.com unreachable, using proxy %s", proxy)
			r.setCache(proxy)
			return proxy
		}
	}

	log.Printf("ghproxy: github.com unreachable and no proxy available, trying direct")
	r.setCache("")
	return ""
}

func (r *Resolver) setCache(proxy string) {
	r.mu.Lock()
	r.cachedProxy = proxy
	r.cacheTime = time.Now()
	r.mu.Unlock()
}

func testGitHub() bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Head("https://github.com")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

func testProxy(proxy string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Head(proxy + "/https://github.com")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}
