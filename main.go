package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/showwin/speedtest-go/speedtest"
	_ "modernc.org/sqlite"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite", "history.db")
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
}

func main() {
	initDB()

	// Serve static files from the "static" directory
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	// LAN Testing Endpoints
	http.HandleFunc("/api/lan/ping", handleLANPing)
	http.HandleFunc("/api/lan/download", handleLANDownload)
	http.HandleFunc("/api/lan/upload", handleLANUpload)
	http.HandleFunc("/api/lan/save", handleLANSave)
	http.HandleFunc("/api/lan/history", handleLANHistory)

	// WAN Testing Endpoints
	http.HandleFunc("/api/wan/test", handleWANTest)
	http.HandleFunc("/api/wan/history", handleWANHistory)

	port := "8080"
	fmt.Printf("NetPaceX server started on port %s...\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
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
	// Get size in megabytes from query param, default to 10MB
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
	Ping           float64 `json:"ping"`
	DownloadMbps   float64 `json:"download"`
	UploadMbps     float64 `json:"upload"`
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

	_, err := db.Exec(`
		INSERT INTO lan_history (ip_address, mac_address, ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?)
	`, ip, mac, req.Ping, req.DownloadMbps, req.UploadMbps)
	
	if err != nil {
		log.Printf("Failed to save LAN history: %v", err)
		http.Error(w, "DB Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// formatLocalTime converts a UTC timestamp string to a formatted local time string
func formatLocalTime(rawDate string) string {
	// Attempt RFC3339 which may be returned by sqlite drivers
	if t, err := time.Parse(time.RFC3339, rawDate); err == nil {
		return t.Local().Format("02 Jan 2006, 15:04:05")
	}
	// Fallback to SQLite CURRENT_TIMESTAMP raw text format (YYYY-MM-DD HH:MM:SS) which is UTC
	if t, err := time.Parse("2006-01-02 15:04:05", rawDate); err == nil {
		tzUTC := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC)
		return tzUTC.Local().Format("02 Jan 2006, 15:04:05")
	}
	return rawDate
}

type LANHistory struct {
	ID           int     `json:"id"`
	IPAddress    string  `json:"ip_address"`
	MACAddress   string  `json:"mac_address"`
	PingMs       float64 `json:"ping_ms"`
	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	TestDate     string  `json:"test_date"`
	RawDate      string  `json:"raw_date"`
}

func handleLANHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, ip_address, mac_address, ping_ms, download_mbps, upload_mbps, test_date FROM lan_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to fetch LAN history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []LANHistory
	for rows.Next() {
		var record LANHistory
		var rawDate string
		if err := rows.Scan(&record.ID, &record.IPAddress, &record.MACAddress, &record.PingMs, &record.DownloadMbps, &record.UploadMbps, &rawDate); err != nil {
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
	ID           int     `json:"id"`
	ServerName   string  `json:"server_name"`
	PingMs       float64 `json:"ping_ms"`
	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	TestDate     string  `json:"test_date"`
	RawDate      string  `json:"raw_date"`
}

func handleWANHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, server_name, ping_ms, download_mbps, upload_mbps, test_date FROM wan_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to fetch history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []WANHistory
	for rows.Next() {
		var record WANHistory
		var rawDate string
		if err := rows.Scan(&record.ID, &record.ServerName, &record.PingMs, &record.DownloadMbps, &record.UploadMbps, &rawDate); err != nil {
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

// handleWANTest performs an Ookla speed test from the server and streams results via SSE
func handleWANTest(w http.ResponseWriter, r *http.Request) {
	// Set headers for Server-Sent Events (SSE)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

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

	// 1. Fetch user info (optional, just for logging context)
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
	// Convert speed to Mbps
	dlMbps := server.DLSpeed.Mbps()
	sendEvent("download", dlMbps, "")

	// 5. Upload Test
	err = server.UploadTest()
	if err != nil {
		sendEvent("error", err.Error(), "Upload test failed")
		return
	}
	// Convert speed to Mbps
	ulMbps := server.ULSpeed.Mbps()
	sendEvent("upload", ulMbps, "")

	// 6. Save to History
	serverName := fmt.Sprintf("%s (%s)", server.Name, server.Country)
	_, dbErr := db.Exec(`
		INSERT INTO wan_history (server_name, ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?)
	`, serverName, float64(server.Latency.Milliseconds()), dlMbps, ulMbps)
	if dbErr != nil {
		log.Printf("Failed to insert history record: %v", dbErr)
	}

	// Finish
	sendEvent("done", nil, "Test completed")
}
