package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/showwin/speedtest-go/speedtest"
	"github.com/m-lab/ndt7-client-go"
	_ "modernc.org/sqlite"
)

var (
	db           *sql.DB
	appPassword  string
	rateLimitMap = make(map[string]time.Time)
	testMutex    sync.Mutex
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

func initDB() {
	// Ensure data directory exists
	if _, err := os.Stat("data"); os.IsNotExist(err) {
		err := os.MkdirAll("data", 0755)
		if err != nil {
			log.Fatalf("Failed to create data directory: %v", err)
		}
	}

	var err error
	db, err = sql.Open("sqlite", "data/history.db")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS wan_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_name TEXT,
		ping_ms REAL,
		download_mbps REAL,
		upload_mbps REAL,
		test_date DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS lan_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ip_address TEXT,
		mac_address TEXT,
		ping_ms REAL,
		download_mbps REAL,
		upload_mbps REAL,
		test_date DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}

	// Settings table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`)
	if err != nil {
		log.Fatalf("Failed to create settings table: %v", err)
	}

	// Default settings
	defaults := map[string]string{
		"timezone": "UTC",
		"wan_unit": "Mbps",
		"lan_unit": "Mbps",
		"mask_mac": "true",
		"allow_delete": "false",
		"default_lang": "en",
		"lock_lang": "false",
		"cron_wan_enable": "false",
		"cron_wan_expr": "0 * * * *",
		"cron_lan_enable": "false",
		"cron_lan_expr": "30 * * * *",
		"cron_lan_target": "",
		"wan_engine": "ookla",
	}
	for k, v := range defaults {
		db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?);`, k, v)
	}

	// Add new columns safely (will error internally if they already exist, which is fine)
	db.Exec(`ALTER TABLE wan_history ADD COLUMN jitter_ms REAL DEFAULT 0;`)
	db.Exec(`ALTER TABLE wan_history ADD COLUMN min_ping_ms REAL DEFAULT 0;`)
	db.Exec(`ALTER TABLE wan_history ADD COLUMN max_ping_ms REAL DEFAULT 0;`)

	db.Exec(`ALTER TABLE lan_history ADD COLUMN jitter_ms REAL DEFAULT 0;`)
	db.Exec(`ALTER TABLE lan_history ADD COLUMN min_ping_ms REAL DEFAULT 0;`)
	db.Exec(`ALTER TABLE lan_history ADD COLUMN max_ping_ms REAL DEFAULT 0;`)
	db.Exec(`ALTER TABLE lan_history ADD COLUMN conn_type TEXT DEFAULT 'Unknown';`)
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
		if envEngine == "ookla" || envEngine == "mlab" {
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

func registerHandler(mux *http.ServeMux, pattern string, handler http.HandlerFunc) {
	mux.Handle(pattern, securityMiddleware(handler))
}

func securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.speedtest.net;")
		next.ServeHTTP(w, r)
	})
}

func rateLimitMiddleware(next http.HandlerFunc, duration time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)
		lastRequest, exists := rateLimitMap[ip]
		if exists && time.Since(lastRequest) < duration {
			http.Error(w, "Too many requests. Please slow down.", http.StatusTooManyRequests)
			return
		}
		rateLimitMap[ip] = time.Now()
		next.ServeHTTP(w, r)
	}
}

var globalCron *cron.Cron

func initScheduler() {
	globalCron = cron.New()
	globalCron.Start()
	updateCron()
}

func updateCron() {
	// Stop existing jobs if any
	currJobs := globalCron.Entries()
	for _, entry := range currJobs {
		globalCron.Remove(entry.ID)
	}

	// Fetch settings
	settings := make(map[string]string)
	rows, err := db.Query("SELECT key, value FROM settings")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			settings[k] = v
		}
	}

	// Schedule WAN
	if settings["cron_wan_enable"] == "true" && settings["cron_wan_expr"] != "" {
		_, err := globalCron.AddFunc(settings["cron_wan_expr"], func() {
			log.Println("Cron: Starting scheduled WAN test...")
			performWANTest()
		})
		if err != nil {
			log.Printf("Cron: Failed to schedule WAN: %v", err)
		} else {
			log.Printf("Cron: WAN scheduled with expr: %s", settings["cron_wan_expr"])
		}
	}

	// Schedule LAN
	if settings["cron_lan_enable"] == "true" && settings["cron_lan_expr"] != "" && settings["cron_lan_target"] != "" {
		targetIP := settings["cron_lan_target"]
		_, err := globalCron.AddFunc(settings["cron_lan_expr"], func() {
			log.Printf("Cron: Starting scheduled LAN test to %s...", targetIP)
			performLANTest(targetIP)
		})
		if err != nil {
			log.Printf("Cron: Failed to schedule LAN: %v", err)
		} else {
			log.Printf("Cron: LAN scheduled to %s with expr: %s", targetIP, settings["cron_lan_expr"])
		}
	}
}

// performLANTest executes a full LAN test suite to a target IP
func performLANTest(targetIP string) {
	if !testMutex.TryLock() {
		log.Printf("Cron: Skipping LAN test to %s because another test is already in progress", targetIP)
		return
	}
	defer testMutex.Unlock()

	startTest := time.Now()
	// This is a simplified version since we can't stream to a real client browser
	// However, we can measure from server to target IP if target IP is another NetPaceX instance
	// or simple ping/throughput if possible.
	// For this implementation, we will perform a Ping + Save record for the target.
	
	// 1. Ping test
	pings := 5
	var totalMs float64
	var minMs float64 = 999999
	var maxMs float64 = 0
	var values []float64

	for i := 0; i < pings; i++ {
		start := time.Now()
		// Simple TCP check if port 8080 is open, or ICMP if we had raw sockets
		// Let's use a simple TCP dial to port 8080 as a proxy for "latency to NetPaceX instance"
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(targetIP, "8080"), 2*time.Second)
		duration := time.Since(start).Seconds() * 1000
		if err == nil {
			conn.Close()
			totalMs += duration
			values = append(values, duration)
			if duration < minMs { minMs = duration }
			if duration > maxMs { maxMs = duration }
		}
		time.Sleep(100 * time.Millisecond)
	}

	if len(values) == 0 {
		log.Printf("Cron: LAN test failed, host %s unreachable", targetIP)
		return
	}

	avgPing := totalMs / float64(len(values))
	
	// Simplified Jitter
	var jitterSum float64
	for i := 1; i < len(values); i++ {
		diff := values[i] - values[i-1]
		if diff < 0 { diff = -diff }
		jitterSum += diff
	}
	avgJitter := jitterSum / float64(len(values)-1)

	// We'll leave DL/UL as 0 for background server-to-server tests for now 
	// unless user wants full iperf integration.
	mac := getMACAddress(targetIP)
	
	_, err := db.Exec(`
		INSERT INTO lan_history (ip_address, mac_address, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, targetIP, mac, avgPing, avgJitter, minMs, maxMs, 0.0, 0.0)

	if err != nil {
		log.Printf("Cron: Failed to save scheduled LAN history: %v", err)
	}
	log.Printf("Cron: LAN test to %s completed in %v", targetIP, time.Since(startTest))
}

// ---------------------------------------------------------
// LAN TEST HANDLERS
// ---------------------------------------------------------

// handleLANPing returns a simple OK to measure latency between client and server
func handleLANPing(w http.ResponseWriter, r *http.Request) {
	// Ensure no caching
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("pong"))
}

// handleLANDownload streams random binary data to the client to measure download speed
func handleLANDownload(w http.ResponseWriter, r *http.Request) {
	if !testMutex.TryLock() {
		http.Error(w, "Another speed test is currently in progress. Please wait for it to finish.", http.StatusConflict)
		return
	}
	defer testMutex.Unlock()

	sizeStr := r.URL.Query().Get("size")
	sizeMB := 10 // Default 10 MB
	if sizeStr != "" {
		if s, err := strconv.Atoi(sizeStr); err == nil && s > 0 && s <= 1000 {
			sizeMB = s
		}
	}

	sizeBytes := int64(sizeMB * 1024 * 1024)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(sizeBytes, 10))
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	// Create a fast random reader using crypto/rand to prevent compression by proxies
	// Note: io.CopyN is efficient enough for this purpose
	io.CopyN(w, rand.Reader, sizeBytes)
}

// handleLANUpload accepts data from the client and discards it to measure upload speed
func handleLANUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !testMutex.TryLock() {
		http.Error(w, "Another speed test is currently in progress. Please wait for it to finish.", http.StatusConflict)
		return
	}
	defer testMutex.Unlock()

	// Discard the entire body
	written, err := io.Copy(io.Discard, r.Body)
	if err != nil {
		http.Error(w, "Error reading upload data", http.StatusInternalServerError)
		return
	}
	defer r.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"bytes":  written,
	})
}

// ---------------------------------------------------------
// LAN HISTORY HANDLERS & HELPERS
// ---------------------------------------------------------

// getClientIP extracts IP from X-Real-IP, X-Forwarded-For, or RemoteAddr
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

// getMACAddress attempts to find MAC from ARP table using the IP
func getMACAddress(ip string) string {
	if ip == "127.0.0.1" || ip == "localhost" {
		return "Localhost / Unbound"
	}
	out, err := exec.Command("arp", "-n", ip).Output()
	if err != nil {
		return "Unknown MAC"
	}

	// Example arp output: "? (192.168.1.5) at a1:b2:c3:d4:e5:f6 on en0 ifscope [ethernet]"
	// Extract MAC using regex
	re := regexp.MustCompile(`([0-9a-fA-F]{1,2}[:-]){5}([0-9a-fA-F]{1,2})`)
	match := re.FindString(string(out))

	if match != "" {
		return strings.ToLower(match)
	}
	return "Unknown MAC"
}

type LANSaveRequest struct {
	Ping         *float64 `json:"ping"`
	Jitter       *float64 `json:"jitter"`
	MinPing      *float64 `json:"min_ping"`
	MaxPing      *float64 `json:"max_ping"`
	DownloadMbps *float64 `json:"download"`
	UploadMbps   *float64 `json:"upload"`
	ConnType     string   `json:"conn_type"`
}

func handleLANSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LANSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid input", http.StatusBadRequest)
		return
	}

	ip := getClientIP(r)
	mac := getMACAddress(ip)

	connType := req.ConnType
	if connType == "" {
		connType = "Unknown"
	}

	_, err := db.Exec(`
		INSERT INTO lan_history (ip_address, mac_address, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps, conn_type) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, ip, mac, req.Ping, req.Jitter, req.MinPing, req.MaxPing, req.DownloadMbps, req.UploadMbps, connType)

	if err != nil {
		log.Printf("Failed to save LAN history: %v", err)
		http.Error(w, "DB Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// formatLocalTime converts a UTC timestamp string to a formatted time string based on user setting
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
	// Attempt RFC3339
	if t, err = time.Parse(time.RFC3339, rawDate); err != nil {
		// Fallback to SQLite CURRENT_TIMESTAMP raw text format (YYYY-MM-DD HH:MM:SS) which is UTC
		if t, err = time.Parse("2006-01-02 15:04:05", rawDate); err != nil {
			return rawDate
		}
		// Ensure it's interpreted as UTC if parsed from current_timestamp
		t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC)
	}

	return t.In(loc).Format("02 Jan 2006, 15:04:05")
}

type LANHistory struct {
	ID           int      `json:"id"`
	IPAddress    string   `json:"ip_address"`
	MACAddress   string   `json:"mac_address"`
	PingMs       *float64 `json:"ping_ms"`
	JitterMs     *float64 `json:"jitter_ms"`
	MinPingMs    *float64 `json:"min_ping_ms"`
	MaxPingMs    *float64 `json:"max_ping_ms"`
	DownloadMbps *float64 `json:"download_mbps"`
	UploadMbps   *float64 `json:"upload_mbps"`
	ConnType     string   `json:"conn_type"`
	TestDate     string   `json:"test_date"`
	RawDate      string   `json:"raw_date"`
}

func handleLANHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, ip_address, mac_address, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps, conn_type, test_date FROM lan_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to fetch LAN history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []LANHistory
	for rows.Next() {
		var record LANHistory
		var rawDate string
		if err := rows.Scan(&record.ID, &record.IPAddress, &record.MACAddress, &record.PingMs, &record.JitterMs, &record.MinPingMs, &record.MaxPingMs, &record.DownloadMbps, &record.UploadMbps, &record.ConnType, &rawDate); err != nil {
			log.Printf("Error scanning lan row: %v", err)
			continue
		}
		record.RawDate = rawDate
		record.TestDate = formatLocalTime(rawDate)
		history = append(history, record)
	}

	if history == nil {
		history = []LANHistory{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// ---------------------------------------------------------
// WAN TEST HANDLERS (Server to Internet)
// ---------------------------------------------------------

type WANHistory struct {
	ID           int      `json:"id"`
	ServerName   string   `json:"server_name"`
	PingMs       *float64 `json:"ping_ms"`
	JitterMs     *float64 `json:"jitter_ms"`
	MinPingMs    *float64 `json:"min_ping_ms"`
	MaxPingMs    *float64 `json:"max_ping_ms"`
	DownloadMbps *float64 `json:"download_mbps"`
	UploadMbps   *float64 `json:"upload_mbps"`
	TestDate     string   `json:"test_date"`
	RawDate      string   `json:"raw_date"`
}

func handleWANHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps, test_date FROM wan_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to fetch history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []WANHistory
	for rows.Next() {
		var record WANHistory
		var rawDate string
		if err := rows.Scan(&record.ID, &record.ServerName, &record.PingMs, &record.JitterMs, &record.MinPingMs, &record.MaxPingMs, &record.DownloadMbps, &record.UploadMbps, &rawDate); err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}
		record.RawDate = rawDate
		record.TestDate = formatLocalTime(rawDate)
		history = append(history, record)
	}

	if history == nil {
		history = []WANHistory{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// Response structure for WAN SSE events
type WANEvent struct {
	Type  string      `json:"type"`  // e.g., "ping", "download", "upload", "done", "error"
	Value interface{} `json:"value"` // e.g., 50.4 (Mbps)
	Info  string      `json:"info"`  // Extra info like server name
}

// getWanEngine returns the currently selected WAN engine from settings
func getWanEngine() string {
	var engine string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'wan_engine'").Scan(&engine)
	if err != nil {
		return "ookla"
	}
	return engine
}

// runMLabTest performs a speed test using the M-Lab NDT7 protocol.
func runMLabTest(ctx context.Context, sseHandler func(WANEvent)) (*WANHistory, error) {
	c := ndt7.NewClient("netpacex", "1.0.0")
	
	send := func(e WANEvent) {
		if sseHandler != nil {
			sseHandler(e)
		}
	}

	send(WANEvent{Type: "info", Info: "Locating M-Lab server..."})
	
	// Download
	send(WANEvent{Type: "info", Info: "Starting M-Lab Download test..."})
	dlResults, err := c.StartDownload(ctx)
	if err != nil {
		return nil, fmt.Errorf("mlab download failed: %v", err)
	}
	
	var finalDl float64
	var minRTT uint32 = 0
	var serverIP string

	for m := range dlResults {
		if m.ConnectionInfo != nil && m.ConnectionInfo.Server != "" {
			serverIP = m.ConnectionInfo.Server
		}
		if m.TCPInfo != nil && m.TCPInfo.MinRTT > 0 {
			if minRTT == 0 || m.TCPInfo.MinRTT < minRTT {
				minRTT = m.TCPInfo.MinRTT
			}
			// Send interim ping update if possible (in ms)
			send(WANEvent{Type: "ping", Value: float64(minRTT) / 1000.0, Info: ""})
		}
		if m.AppInfo != nil {
			elapsed := float64(m.AppInfo.ElapsedTime) / 1000000.0 // seconds
			if elapsed > 0 {
				mbps := (float64(m.AppInfo.NumBytes) * 8 / 1000000.0) / elapsed
				finalDl = mbps
				send(WANEvent{Type: "download", Value: mbps})
			}
		}
	}

	// Upload
	send(WANEvent{Type: "info", Info: "Starting M-Lab Upload test..."})
	ulResults, err := c.StartUpload(ctx)
	if err != nil {
		return nil, fmt.Errorf("mlab upload failed: %v", err)
	}

	var finalUl float64
	for m := range ulResults {
		if m.TCPInfo != nil && m.TCPInfo.MinRTT > 0 {
			if minRTT == 0 || m.TCPInfo.MinRTT < minRTT {
				minRTT = m.TCPInfo.MinRTT
			}
			send(WANEvent{Type: "ping", Value: float64(minRTT) / 1000.0, Info: ""})
		}
		if m.AppInfo != nil {
			elapsed := float64(m.AppInfo.ElapsedTime) / 1000000.0
			if elapsed > 0 {
				mbps := (float64(m.AppInfo.NumBytes) * 8 / 1000000.0) / elapsed
				finalUl = mbps
				send(WANEvent{Type: "upload", Value: mbps})
			}
		}
	}

	displayServer := "M-Lab NDT7 Server"
	if serverIP != "" {
		displayServer = fmt.Sprintf("%s (M-Lab NDT7)", serverIP)
	}

	record := &WANHistory{
		ServerName:   displayServer,
		PingMs:       floatPtr(float64(minRTT) / 1000.0),
		DownloadMbps: floatPtr(finalDl),
		UploadMbps:   floatPtr(finalUl),
	}
	if minRTT == 0 {
		record.PingMs = nil
	}
	if finalDl == 0 {
		record.DownloadMbps = nil
	}
	if finalUl == 0 {
		record.UploadMbps = nil
	}
	return record, nil
}

// performWANTest executes a speedtest and returns results. Does NOT use flusher/SSE.
func performWANTest() (*WANHistory, error) {
	if !testMutex.TryLock() {
		return nil, fmt.Errorf("another test is already in progress")
	}
	defer testMutex.Unlock()

	engine := getWanEngine()
	if engine == "mlab" {
		record, err := runMLabTest(context.Background(), nil)
		if err != nil {
			return nil, err
		}
		_, dbErr := db.Exec(`
			INSERT INTO wan_history (server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, record.ServerName, record.PingMs, record.JitterMs, record.MinPingMs, record.MaxPingMs, record.DownloadMbps, record.UploadMbps)
		if dbErr != nil {
			log.Printf("Failed to insert scheduled M-Lab WAN history: %v", dbErr)
		}
		return record, nil
	}

	startTest := time.Now()
	log.Println("Cron: Starting WAN speed test (Ookla)...")
	// 1. Fetch user info
	_, err := speedtest.FetchUserInfo()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user info: %v", err)
	}

	// 2. Fetch server list and find closest
	serverList, err := speedtest.FetchServers()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch server list: %v", err)
	}

	targets, err := serverList.FindServer(nil)
	if err != nil || len(targets) == 0 {
		return nil, fmt.Errorf("failed to find suitable test server")
	}

	server := targets[0]
	log.Printf("Cron: Selected Server: %s - %s (%s) Distance: %.2f km", server.ID, server.Name, server.Country, server.Distance)

	// 3. Ping Test
	log.Println("Cron: Starting Ping test...")
	err = server.PingTest(nil)
	if err != nil {
		return nil, fmt.Errorf("ping test failed: %v", err)
	}
	log.Printf("Cron: Ping result: %v ms (Jitter: %v ms)", server.Latency.Milliseconds(), server.Jitter.Milliseconds())

	// 4. Download Test
	log.Println("Cron: Starting Download test...")
	err = server.DownloadTest()
	if err != nil {
		return nil, fmt.Errorf("download test failed: %v", err)
	}
	dlMbps := server.DLSpeed.Mbps()
	log.Printf("Cron: Download result: %.2f Mbps", dlMbps)

	// 5. Upload Test
	log.Println("Cron: Starting Upload test...")
	err = server.UploadTest()
	if err != nil {
		return nil, fmt.Errorf("upload test failed: %v", err)
	}
	ulMbps := server.ULSpeed.Mbps()
	log.Printf("Cron: Upload result: %.2f Mbps", ulMbps)

	// 6. Save to History
	serverName := fmt.Sprintf("%s (%s)", server.Name, server.Country)
	record := &WANHistory{
		ServerName:   serverName,
		PingMs:       floatPtr(float64(server.Latency.Milliseconds())),
		JitterMs:     floatPtr(float64(server.Jitter.Milliseconds())),
		MinPingMs:    floatPtr(float64(server.MinLatency.Milliseconds())),
		MaxPingMs:    floatPtr(float64(server.MaxLatency.Milliseconds())),
		DownloadMbps: floatPtr(dlMbps),
		UploadMbps:   floatPtr(ulMbps),
	}

	_, dbErr := db.Exec(`
		INSERT INTO wan_history (server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, record.ServerName, record.PingMs, record.JitterMs, record.MinPingMs, record.MaxPingMs, record.DownloadMbps, record.UploadMbps)
	if dbErr != nil {
		log.Printf("Failed to insert scheduled WAN history: %v", dbErr)
	}

	log.Printf("Cron: WAN test completed in %v", time.Since(startTest))
	return record, nil
}

// handleWANTest performs an Ookla speed test from the server and streams results via SSE
func handleWANTest(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	sendEvent := func(eventType string, value interface{}, info string) {
		event := WANEvent{Type: eventType, Value: value, Info: info}
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	if !testMutex.TryLock() {
		sendEvent("error", "Test in progress", "Another speed test is currently in progress. Please wait for it to finish.")
		return
	}
	defer testMutex.Unlock()

	engine := getWanEngine()
	if engine == "mlab" {
		record, err := runMLabTest(r.Context(), func(e WANEvent) {
			sendEvent(e.Type, e.Value, e.Info)
		})
		if err != nil {
			sendEvent("error", err.Error(), "M-Lab test failed")
			return
		}
		// Save M-Lab record to history manually since runMLabTest doesn't do it yet
		_, dbErr := db.Exec(`
			INSERT INTO wan_history (server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, record.ServerName, record.PingMs, record.JitterMs, record.MinPingMs, record.MaxPingMs, record.DownloadMbps, record.UploadMbps)
		if dbErr != nil {
			log.Printf("Failed to insert M-Lab WAN history: %v", dbErr)
		}
		sendEvent("done", nil, "Test completed")
		return
	}

	// 1. Fetch user info
	user, err := speedtest.FetchUserInfo()
	if err != nil {
		sendEvent("error", err.Error(), "Failed to fetch user info")
		return
	}
	sendEvent("info", nil, fmt.Sprintf("Testing from IP: %s (%s)", user.IP, user.Isp))

	// 2. Fetch server list and find closest
	serverList, err := speedtest.FetchServers()
	if err != nil {
		sendEvent("error", err.Error(), "Failed to fetch server list")
		return
	}

	targets, err := serverList.FindServer(nil)
	if err != nil || len(targets) == 0 {
		sendEvent("error", err.Error(), "Failed to find suitable test server")
		return
	}

	server := targets[0]
	sendEvent("info", nil, fmt.Sprintf("Selected Server: %s (%s)", server.Name, server.Country))

	// 3. Ping Test
	err = server.PingTest(nil)
	if err != nil {
		sendEvent("error", err.Error(), "Ping test failed")
		return
	}
	sendEvent("ping", server.Latency.Milliseconds(), "")

	// 4. Download Test
	err = server.DownloadTest()
	if err != nil {
		sendEvent("error", err.Error(), "Download test failed")
		return
	}
	dlMbps := server.DLSpeed.Mbps()
	sendEvent("download", dlMbps, "")

	// 5. Upload Test
	err = server.UploadTest()
	if err != nil {
		sendEvent("error", err.Error(), "Upload test failed")
		return
	}
	ulMbps := server.ULSpeed.Mbps()
	sendEvent("upload", ulMbps, "")

	// 6. Save to History
	serverName := fmt.Sprintf("%s (%s)", server.Name, server.Country)
	_, dbErr := db.Exec(`
		INSERT INTO wan_history (server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, serverName, float64(server.Latency.Milliseconds()), float64(server.Jitter.Milliseconds()), float64(server.MinLatency.Milliseconds()), float64(server.MaxLatency.Milliseconds()), dlMbps, ulMbps)
	if dbErr != nil {
		log.Printf("Failed to insert history record: %v", dbErr)
	}

	// Finish
	sendEvent("done", nil, "Test completed")
}

// ---------------------------------------------------------
// SETTINGS & AUTH HANDLERS
// ---------------------------------------------------------

func handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		rows, err := db.Query("SELECT key, value FROM settings")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		settings := make(map[string]string)
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			settings[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)
	} else if r.Method == http.MethodPost {
		var settings map[string]string
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			http.Error(w, "Invalid input", http.StatusBadRequest)
			return
		}

		for k, v := range settings {
			_, err := db.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", k, v)
			if err != nil {
				log.Printf("Failed to update setting %s: %v", k, err)
			}
		}
		updateCron()
		w.WriteHeader(http.StatusOK)
	}
}

func handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"password_enabled": appPassword != "",
	})
}

func handleAuthVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid input", http.StatusBadRequest)
		return
	}

	if appPassword != "" && req.Password == appPassword {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	} else {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	}
}

func handleWANHistoryDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("DELETE FROM wan_history WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleLANHistoryDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("DELETE FROM lan_history WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleTimezones(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allTimezones)
}

var allTimezones = []string{
	"UTC",
	"Africa/Abidjan", "Africa/Accra", "Africa/Addis Ababa", "Africa/Algiers", "Africa/Asmara",
	"Africa/Bamako", "Africa/Bangui", "Africa/Banjul", "Africa/Bissau", "Africa/Blantyre",
	"Africa/Brazzaville", "Africa/Bujumbura", "Africa/Cairo", "Africa/Casablanca", "Africa/Ceuta",
	"Africa/Conakry", "Africa/Dakar", "Africa/Dar es Salaam", "Africa/Djibouti", "Africa/Douala",
	"Africa/El Aaiun", "Africa/Freetown", "Africa/Gaborone", "Africa/Harare", "Africa/Johannesburg",
	"Africa/Juba", "Africa/Kampala", "Africa/Khartoum", "Africa/Kigali", "Africa/Kinshasa",
	"Africa/Lagos", "Africa/Libreville", "Africa/Lome", "Africa/Luanda", "Africa/Lubumbashi",
	"Africa/Lusaka", "Africa/Malabo", "Africa/Maputo", "Africa/Maseru", "Africa/Mbabane",
	"Africa/Mogadishu", "Africa/Monrovia", "Africa/Nairobi", "Africa/Ndjamena", "Africa/Niamey",
	"Africa/Nouakchott", "Africa/Ouagadougou", "Africa/Porto-Novo", "Africa/Sao Tome", "Africa/Tripoli",
	"Africa/Tunis", "Africa/Windhoek",
	"America/Adak", "America/Anchorage", "America/Anguilla", "America/Antigua", "America/Araguaina",
	"America/Argentina/Buenos Aires", "America/Argentina/Catamarca", "America/Argentina/Cordoba", "America/Argentina/Jujuy", "America/Argentina/La_Rioja",
	"America/Argentina/Mendoza", "America/Argentina/Rio Gallegos", "America/Argentina/Salta", "America/Argentina/San_Juan", "America/Argentina/San_Luis",
	"America/Argentina/Tucuman", "America/Argentina/Ushuaia", "America/Aruba", "America/Asuncion", "America/Atikokan",
	"America/Bahia", "America/Bahia Banderas", "America/Barbados", "America/Belem", "America/Belize",
	"America/Blanc-Sablon", "America/Boa Vista", "America/Bogota", "America/Boise", "America/Cambridge Bay",
	"America/Campo Grande", "America/Cancun", "America/Caracas", "America/Cayenne", "America/Cayman",
	"America/Chicago", "America/Chihuahua", "America/Costa Rica", "America/Creston", "America/Cuiaba",
	"America/Curacao", "America/Danmarkshavn", "America/Dawson", "America/Dawson Creek", "America/Denver",
	"America/Detroit", "America/Dominica", "America/Edmonton", "America/Eirunepe", "America/El Salvador",
	"America/Fort Nelson", "America/Fortaleza", "America/Glace Bay", "America/Goose Bay", "America/Grand Turk",
	"America/Grenada", "America/Guadeloupe", "America/Guatemala", "America/Guayaquil", "America/Guyana",
	"America/Halifax", "America/Havana", "America/Hermosillo", "America/Indiana/Indianapolis", "America/Indiana/Knox",
	"America/Indiana/Marengo", "America/Indiana/Petersburg", "America/Indiana/Tell City", "America/Indiana/Vevay", "America/Indiana/Vincennes",
	"America/Indiana/Winamac", "America/Inuvik", "America/Iqaluit", "America/Jamaica", "America/Juneau",
	"America/Kentucky/Louisville", "America/Kentucky/Monticello", "America/Kralendijk", "America/La Paz", "America/Lima",
	"America/Los Angeles", "America/Lower Princes", "America/Maceio", "America/Managua", "America/Manaus",
	"America/Marigot", "America/Martinique", "America/Matamoros", "America/Mazatlan", "America/Menominee",
	"America/Merida", "America/Metlakatla", "America/Mexico City", "America/Miquelon", "America/Moncton",
	"America/Monterrey", "America/Montevideo", "America/Montserrat", "America/Nassau", "America/New York",
	"America/Nipigon", "America/Nome", "America/Noronha", "America/North Dakota/Beulah", "America/North Dakota/Center",
	"America/North Dakota/New Salem", "America/Nuuk", "America/Ojinaga", "America/Panama", "America/Pangnirtung",
	"America/Paramaribo", "America/Phoenix", "America/Port-au-Prince", "America/Port of Spain", "America/Porto Velho",
	"America/Puerto Rico", "America/Punta Arenas", "America/Rainy River", "America/Rankin Inlet", "America/Recife",
	"America/Regina", "America/Resolute", "America/Rio Branco", "America/Santarem", "America/Santiago",
	"America/Santo Domingo", "America/Sao Paulo", "America/Scoresbysund", "America/Sitka", "America/St Barthelemy",
	"America/St Johns", "America/St Kitts", "America/St Lucia", "America/St Thomas", "America/St Vincent",
	"America/Swift Current", "America/Tegucigalpa", "America/Thule", "America/Thunder Bay", "America/Tijuana",
	"America/Toronto", "America/Tortola", "America/Vancouver", "America/Whitehorse", "America/Winnipeg",
	"America/Yakutat", "America/Yellowknife",
	"Antarctica/Casey", "Antarctica/Davis", "Antarctica/DumontDUrville", "Antarctica/Mawson", "Antarctica/McMurdo",
	"Antarctica/Palmer", "Antarctica/Rothera", "Antarctica/Syowa", "Antarctica/Troll", "Antarctica/Vostok",
	"Asia/Aden", "Asia/Almaty", "Asia/Amman", "Asia/Anadyr", "Asia/Aqtau",
	"Asia/Aqtobe", "Asia/Ashgabat", "Asia/Atyrau", "Asia/Baghdad", "Asia/Bahrain",
	"Asia/Baku", "Asia/Bangkok", "Asia/Barnaul", "Asia/Beirut", "Asia/Bishkek",
	"Asia/Brunei", "Asia/Chita", "Asia/Choibalsan", "Asia/Colombo", "Asia/Damascus",
	"Asia/Dhaka", "Asia/Dili", "Asia/Dubai", "Asia/Dushanbe", "Asia/Famagusta",
	"Asia/Gaza", "Asia/Hebron", "Asia/Ho Chi Minh", "Asia/Hong Kong", "Asia/Hovd",
	"Asia/Irkutsk", "Asia/Jakarta", "Asia/Jayapura", "Asia/Jerusalem", "Asia/Kabul",
	"Asia/Kamchatka", "Asia/Karachi", "Asia/Kathmandu", "Asia/Khandyga", "Asia/Kolkata",
	"Asia/Krasnoyarsk", "Asia/Kuala Lumpur", "Asia/Kuching", "Asia/Kuwait", "Asia/Macau",
	"Asia/Magadan", "Asia/Makassar", "Asia/Manila", "Asia/Muscat", "Asia/Nicosia",
	"Asia/Novokuznetsk", "Asia/Novosibirsk", "Asia/Omsk", "Asia/Oral", "Asia/Phnom Penh",
	"Asia/Pontianak", "Asia/Pyongyang", "Asia/Qatar", "Asia/Qostanay", "Asia/Qyzylorda",
	"Asia/Riyadh", "Asia/Sakhalin", "Asia/Samarkand", "Asia/Seoul", "Asia/Shanghai",
	"Asia/Singapore", "Asia/Srednekolymsk", "Asia/Taipei", "Asia/Tashkent", "Asia/Tbilisi",
	"Asia/Tehran", "Asia/Thimphu", "Asia/Tokyo", "Asia/Tomsk", "Asia/Ulaanbaatar",
	"Asia/Urumqi", "Asia/Ust-Nera", "Asia/Vientiane", "Asia/Vladivostok", "Asia/Yakutsk",
	"Asia/Yangon", "Asia/Yekaterinburg", "Asia/Yerevan",
	"Atlantic/Azores", "Atlantic/Bermuda", "Atlantic/Canary", "Atlantic/Cape Verde", "Atlantic/Faroe",
	"Atlantic/Madeira", "Atlantic/Reykjavik", "Atlantic/South Georgia", "Atlantic/St Helena", "Atlantic/Stanley",
	"Australia/Adelaide", "Australia/Brisbane", "Australia/Broken Hill", "Australia/Darwin", "Australia/Eucla",
	"Australia/Hobart", "Australia/Lindeman", "Australia/Lord Howe", "Australia/Melbourne", "Australia/Perth",
	"Australia/Sydney",
	"Europe/Amsterdam", "Europe/Andorra", "Europe/Astrakhan", "Europe/Athens", "Europe/Belgrade",
	"Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Bucharest", "Europe/Budapest",
	"Europe/Busingen", "Europe/Chisinau", "Europe/Copenhagen", "Europe/Dublin", "Europe/Gibraltar",
	"Europe/Guernsey", "Europe/Helsinki", "Europe/Isle of Man", "Europe/Istanbul", "Europe/Jersey",
	"Europe/Kaliningrad", "Europe/Kiev", "Europe/Kirov", "Europe/Lisbon", "Europe/Ljubljana",
	"Europe/London", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn",
	"Europe/Minsk", "Europe/Monaco", "Europe/Moscow", "Europe/Oslo", "Europe/Paris",
	"Europe/Podgorica", "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Samara",
	"Europe/San Marino", "Europe/Sarajevo", "Europe/Saratov", "Europe/Simferopol", "Europe/Skopje",
	"Europe/Sofia", "Europe/Stockholm", "Europe/Tallinn", "Europe/Tirane", "Europe/Ulyanovsk",
	"Europe/Uzhgorod", "Europe/Vaduz", "Europe/Vatican", "Europe/Vienna", "Europe/Vilnius",
	"Europe/Volgograd", "Europe/Warsaw", "Europe/Zagreb", "Europe/Zaporozhye", "Europe/Zurich",
	"Indian/Antananarivo", "Indian/Chagos", "Indian/Christmas", "Indian/Cocos", "Indian/Comoro",
	"Indian/Kerguelen", "Indian/Mahe", "Indian/Maldives", "Indian/Mauritius", "Indian/Mayotte",
	"Indian/Reunion",
	"Pacific/Apia", "Pacific/Auckland", "Pacific/Bougainville", "Pacific/Chatham", "Pacific/Chuuk",
	"Pacific/Easter", "Pacific/Efate", "Pacific/Fakaofo", "Pacific/Fiji", "Pacific/Funafuti",
	"Pacific/Galapagos", "Pacific/Gambier", "Pacific/Guadalcanal", "Pacific/Guam", "Pacific/Honolulu",
	"Pacific/Kanton", "Pacific/Kiritimati", "Pacific/Kosrae", "Pacific/Kwajalein", "Pacific/Majuro",
	"Pacific/Marquesas", "Pacific/Midway", "Pacific/Nauru", "Pacific/Niue", "Pacific/Norfolk",
	"Pacific/Noumea", "Pacific/Pago Pago", "Pacific/Palau", "Pacific/Pitcairn", "Pacific/Pohnpei",
	"Pacific/Port Moresby", "Pacific/Rarotonga", "Pacific/Saipan", "Pacific/Tahiti", "Pacific/Tarawa",
	"Pacific/Tongatapu", "Pacific/Wake", "Pacific/Wallis",
}
