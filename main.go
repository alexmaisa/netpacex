package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/showwin/speedtest-go/speedtest"
)

func main() {
	// Serve static files from the "static" directory
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	// LAN Testing Endpoints
	http.HandleFunc("/api/lan/ping", handleLANPing)
	http.HandleFunc("/api/lan/download", handleLANDownload)
	http.HandleFunc("/api/lan/upload", handleLANUpload)

	// WAN Testing Endpoints
	http.HandleFunc("/api/wan/test", handleWANTest)

	port := "8080"
	fmt.Printf("NetPace server started on port %s...\n", port)
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
// WAN TEST HANDLERS (Server to Internet)
// ---------------------------------------------------------

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

	// Finish
	sendEvent("done", nil, "Test completed")
}
