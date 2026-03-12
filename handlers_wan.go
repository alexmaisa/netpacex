package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/m-lab/ndt7-client-go"
	"github.com/showwin/speedtest-go/speedtest"
)

// Response structure for WAN SSE events
type WANEvent struct {
	Type  string      `json:"type"`  // e.g., "ping", "download", "upload", "done", "error"
	Value interface{} `json:"value"` // e.g., 50.4 (Mbps)
	Info  string      `json:"info"`  // Extra info like server name
}

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
	var maxRTT uint32 = 0
	var totalRTTVar uint32 = 0
	var rttVarSamples int = 0
	var serverIP string

	for m := range dlResults {
		if m.ConnectionInfo != nil && m.ConnectionInfo.Server != "" {
			serverIP = m.ConnectionInfo.Server
		}
		if m.TCPInfo != nil {
			if m.TCPInfo.MinRTT > 0 {
				if minRTT == 0 || m.TCPInfo.MinRTT < minRTT {
					minRTT = m.TCPInfo.MinRTT
				}
			}
			if m.TCPInfo.RTT > maxRTT {
				maxRTT = m.TCPInfo.RTT
			}
			if m.TCPInfo.RTTVar > 0 {
				totalRTTVar += m.TCPInfo.RTTVar
				rttVarSamples++
				send(WANEvent{Type: "jitter", Value: float64(m.TCPInfo.RTTVar) / 1000.0})
			}
			if minRTT > 0 {
				send(WANEvent{Type: "ping", Value: float64(minRTT) / 1000.0})
			}
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
		if m.TCPInfo != nil {
			if m.TCPInfo.MinRTT > 0 {
				if minRTT == 0 || m.TCPInfo.MinRTT < minRTT {
					minRTT = m.TCPInfo.MinRTT
				}
			}
			if m.TCPInfo.RTT > maxRTT {
				maxRTT = m.TCPInfo.RTT
			}
			if m.TCPInfo.RTTVar > 0 {
				totalRTTVar += m.TCPInfo.RTTVar
				rttVarSamples++
				send(WANEvent{Type: "jitter", Value: float64(m.TCPInfo.RTTVar) / 1000.0})
			}
			if minRTT > 0 {
				send(WANEvent{Type: "ping", Value: float64(minRTT) / 1000.0})
			}
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

	avgJitter := 0.0
	if rttVarSamples > 0 {
		avgJitter = float64(totalRTTVar) / float64(rttVarSamples) / 1000.0
	}

	record := &WANHistory{
		ServerName:   displayServer,
		PingMs:       floatPtr(float64(minRTT) / 1000.0),
		JitterMs:     floatPtr(avgJitter),
		MinPingMs:    floatPtr(float64(minRTT) / 1000.0),
		MaxPingMs:    floatPtr(float64(maxRTT) / 1000.0),
		DownloadMbps: floatPtr(finalDl),
		UploadMbps:   floatPtr(finalUl),
	}

	if minRTT == 0 {
		record.PingMs = nil
		record.MinPingMs = nil
	}
	if maxRTT == 0 {
		record.MaxPingMs = nil
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
	_, err := speedtest.FetchUserInfo()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user info: %v", err)
	}

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

	log.Println("Cron: Starting Ping test...")
	err = server.PingTest(nil)
	if err != nil {
		return nil, fmt.Errorf("ping test failed: %v", err)
	}
	log.Printf("Cron: Ping result: %v ms (Jitter: %v ms)", server.Latency.Milliseconds(), server.Jitter.Milliseconds())

	log.Println("Cron: Starting Download test...")
	err = server.DownloadTest()
	if err != nil {
		return nil, fmt.Errorf("download test failed: %v", err)
	}
	dlMbps := server.DLSpeed.Mbps()
	log.Printf("Cron: Download result: %.2f Mbps", dlMbps)

	log.Println("Cron: Starting Upload test...")
	err = server.UploadTest()
	if err != nil {
		return nil, fmt.Errorf("upload test failed: %v", err)
	}
	ulMbps := server.ULSpeed.Mbps()
	log.Printf("Cron: Upload result: %.2f Mbps", ulMbps)

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

	user, err := speedtest.FetchUserInfo()
	if err != nil {
		sendEvent("error", err.Error(), "Failed to fetch user info")
		return
	}
	sendEvent("info", nil, fmt.Sprintf("Testing from IP: %s (%s)", user.IP, user.Isp))

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

	err = server.PingTest(nil)
	if err != nil {
		sendEvent("error", err.Error(), "Ping test failed")
		return
	}
	sendEvent("ping", float64(server.Latency.Milliseconds()), "")
	sendEvent("jitter", float64(server.Jitter.Milliseconds()), "")

	err = server.DownloadTest()
	if err != nil {
		sendEvent("error", err.Error(), "Download test failed")
		return
	}
	dlMbps := server.DLSpeed.Mbps()
	sendEvent("download", dlMbps, "")

	err = server.UploadTest()
	if err != nil {
		sendEvent("error", err.Error(), "Upload test failed")
		return
	}
	ulMbps := server.ULSpeed.Mbps()
	sendEvent("upload", ulMbps, "")

	serverName := fmt.Sprintf("%s (%s)", server.Name, server.Country)
	_, dbErr := db.Exec(`
		INSERT INTO wan_history (server_name, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, serverName, float64(server.Latency.Milliseconds()), float64(server.Jitter.Milliseconds()), float64(server.MinLatency.Milliseconds()), float64(server.MaxLatency.Milliseconds()), dlMbps, ulMbps)
	if dbErr != nil {
		log.Printf("Failed to insert history record: %v", dbErr)
	}

	sendEvent("done", nil, "Test completed")
}
