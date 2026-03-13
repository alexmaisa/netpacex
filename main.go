package main

const version = "v1.3.7"

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func init() {
	loadEnv()
	appPassword = strings.Trim(os.Getenv("APP_PASSWORD"), " \t\n\r\"'")
	envTZ := os.Getenv("TZ")

	if appPassword != "" {
		log.Printf("Security: APP_PASSWORD loaded (length: %d)", len(appPassword))
	} else {
		log.Println("Security: No APP_PASSWORD set, features will be disabled")
	}

	if envTZ != "" {
		log.Printf("Config: TZ environment variable found: %s", envTZ)
	} else {
		log.Println("Config: No TZ environment variable found, using database/default")
	}
}

func main() {
	initDB()

	// Sync environment variables to database settings
	envTZ := os.Getenv("TZ")
	if envTZ != "" {
		_, err := db.Exec(`UPDATE settings SET value = ? WHERE key = 'timezone'`, envTZ)
		if err != nil {
			log.Printf("Config: Failed to sync TZ to database: %v", err)
		} else {
			log.Printf("Config: Timezone synced to %s", envTZ)
		}
	}
	
	envEngine := os.Getenv("WAN_ENGINE")
	if envEngine != "" {
		envEngine = strings.ToLower(envEngine)
		if envEngine == "ookla" || envEngine == "mlab" || envEngine == "cloudflare" {
			_, err := db.Exec(`UPDATE settings SET value = ? WHERE key = 'wan_engine'`, envEngine)
			if err != nil {
				log.Printf("Config: Failed to sync WAN_ENGINE to database: %v", err)
			} else {
				log.Printf("Config: WAN engine synced to %s", envEngine)
			}
		}
	}

	mux := http.NewServeMux()

	// Serve static files
	fs := http.FileServer(http.Dir("./static"))
	mux.Handle("/", securityMiddleware(fs))

	// API Endpoints - Wrapped with security middleware
	registerHandler(mux, "/api/lan/ping", handleLANPing)
	registerHandler(mux, "/api/lan/download", handleLANDownload)
	registerHandler(mux, "/api/lan/upload", handleLANUpload)
	registerHandler(mux, "/api/lan/save", handleLANSave)
	registerHandler(mux, "/api/lan/history", handleLANHistory)
	registerHandler(mux, "/api/wan/test", handleWANTest)
	registerHandler(mux, "/api/wan/history", handleWANHistory)
	registerHandler(mux, "/api/settings", handleSettings)
	registerHandler(mux, "/api/auth/check", handleAuthCheck)
	registerHandler(mux, "/api/auth/verify", rateLimitMiddleware(handleAuthVerify, 2*time.Second)) // Rate limit auth
	registerHandler(mux, "/api/timezones", handleTimezones)
	registerHandler(mux, "/api/wan/history/delete", handleWANHistoryDelete)
	registerHandler(mux, "/api/lan/history/delete", handleLANHistoryDelete)

	initScheduler()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	fmt.Printf("NetPaceX server started on port %s...\n", port)

	// Graceful shutdown
	done := make(chan struct{})
	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt, syscall.SIGTERM)
		<-sigint

		fmt.Println("\nShutting down server gracefully...")
		
		if globalCron != nil {
			log.Println("Stopping scheduler...")
			globalCron.Stop()
		}

		if db != nil {
			log.Println("Closing database...")
			db.Close()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
		close(done)
	}()

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}

	<-done
	log.Println("Server stopped")
}
