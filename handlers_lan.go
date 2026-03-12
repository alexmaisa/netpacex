package main

import (
	"crypto/rand"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"time"
)

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

// performLANTest executes a full LAN test suite to a target IP
func performLANTest(targetIP string) {
	if !testMutex.TryLock() {
		log.Printf("Cron: Skipping LAN test to %s because another test is already in progress", targetIP)
		return
	}
	defer testMutex.Unlock()

	startTest := time.Now()
	
	pings := 5
	var totalMs float64
	var minMs float64 = 999999
	var maxMs float64 = 0
	var values []float64

	for i := 0; i < pings; i++ {
		start := time.Now()
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
	
	var jitterSum float64
	for i := 1; i < len(values); i++ {
		diff := values[i] - values[i-1]
		if diff < 0 { diff = -diff }
		jitterSum += diff
	}
	avgJitter := jitterSum / float64(len(values)-1)

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
