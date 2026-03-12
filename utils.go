package main

import (
	"database/sql"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
)

var (
	db           *sql.DB
	appPassword  string
	rateLimitMap = make(map[string]time.Time)
	testMutex    sync.Mutex
	globalCron   *cron.Cron
)

func loadEnv() {
	file, err := os.Open(".env")
	if err != nil {
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return
	}

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
			if os.Getenv(key) == "" {
				os.Setenv(key, value)
			}
		}
	}
}

func floatPtr(v float64) *float64 {
	return &v
}

func registerHandler(mux *http.ServeMux, pattern string, handler http.HandlerFunc) {
	mux.Handle(pattern, securityMiddleware(handler))
}

func getClientIP(r *http.Request) string {
	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip = r.Header.Get("X-Forwarded-For")
	}
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	}
	if ip == "::1" || ip == "" {
		ip = "127.0.0.1" // Default local
	}
	return ip
}

func getMACAddress(ip string) string {
	if ip == "127.0.0.1" || ip == "localhost" {
		return "Localhost / Unbound"
	}
	out, err := exec.Command("arp", "-n", ip).Output()
	if err != nil {
		return "Unknown MAC"
	}

	re := regexp.MustCompile(`([0-9a-fA-F]{1,2}[:-]){5}([0-9a-fA-F]{1,2})`)
	match := re.FindString(string(out))

	if match != "" {
		return strings.ToLower(match)
	}
	return "Unknown MAC"
}

func formatLocalTime(rawDate string) string {
	var tzName string
	db.QueryRow("SELECT value FROM settings WHERE key = 'timezone'").Scan(&tzName)
	if tzName == "" {
		tzName = "UTC"
	}

	loc, err := time.LoadLocation(tzName)
	if err != nil {
		loc = time.UTC
	}

	var t time.Time
	if t, err = time.Parse(time.RFC3339, rawDate); err != nil {
		if t, err = time.Parse("2006-01-02 15:04:05", rawDate); err != nil {
			return rawDate
		}
		t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC)
	}

	return t.In(loc).Format("02 Jan 2006, 15:04:05")
}
