package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/server-monitor/agent/internal/auth"
	"github.com/server-monitor/agent/internal/config"
	"github.com/server-monitor/agent/internal/module"
	"github.com/server-monitor/agent/internal/plugin"
	"github.com/server-monitor/agent/internal/update"
	"github.com/server-monitor/agent/internal/version"

	// Import packages to trigger init() registrations for all modules.
	_ "github.com/server-monitor/agent/internal/alert"
	_ "github.com/server-monitor/agent/internal/module"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("Server Monitor Agent %s (%s) starting...", version.Version, version.Commit)

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Config: port=%d, interval=%ds, history=%ds",
		cfg.Port, cfg.CollectInterval, cfg.HistoryDuration)

	// Load built-in modules
	modules := module.EnabledModules(cfg)

	// Load external plugins
	pluginMgr := plugin.NewManager(cfg)
	pluginModules := pluginMgr.ScanAndStart()
	modules = append(modules, pluginModules...)

	startTime := time.Now()

	// Build routes from modules
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", module.HealthHandler())
	mux.HandleFunc("/api/info", module.InfoHandler(modules, startTime))

	for _, m := range modules {
		for _, r := range m.Routes() {
			mux.HandleFunc(r.Path, r.Handler)
		}
	}

	// Plugin management API
	pluginStore := plugin.NewStore(cfg.Plugins.Stores)
	pluginAPI := plugin.NewAPI(pluginMgr, pluginStore)
	pluginAPI.RegisterRoutes(mux)

	// Self-update API
	if cfg.GitHubRepo != "" {
		updater := update.NewUpdater(cfg.GitHubRepo)
		updater.RegisterRoutes(mux)
		log.Printf("Update: auto-update enabled (repo: %s)", cfg.GitHubRepo)
	}

	// Start periodic collection scheduler
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler := module.NewScheduler(
		time.Duration(cfg.CollectInterval)*time.Second,
		modules,
	)
	go scheduler.Run(ctx)

	// Apply middleware: CORS -> Auth -> Routes
	var h http.Handler = mux
	h = auth.TokenAuth(cfg.AuthToken, h)
	h = auth.CORS(h)

	// Create server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      h,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // disabled; SSE handlers manage deadlines via ResponseController
		IdleTimeout:  60 * time.Second,
	}

	// Handle signals for graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		log.Printf("Received signal %v, shutting down...", sig)

		cancel() // stop scheduler

		// Graceful shutdown with timeout
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Graceful shutdown error: %v", err)
			server.Close()
		}
	}()

	log.Printf("Listening on :%d", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}

	// Stop external plugins
	pluginMgr.StopAll()

	// Close built-in modules
	for _, m := range modules {
		m.Close()
	}

	log.Println("Server stopped.")
}
