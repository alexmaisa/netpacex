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
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/showwin/speedtest-go/speedtest"
	_ "modernc.org/sqlite"
)

var db *sql.DB
var appPassword string

func init() {
	appPassword = os.Getenv("APP_PASSWORD")
}

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

	// Settings table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`)
	if err != nil {
		log.Fatalf("Failed to create settings table: %v", err)
	}

	// Default settings
	defaults := map[string]string{
		"timezone":    "UTC",
		"wan_unit":    "Mbps",
		"lan_unit":    "Mbps",
		"mask_mac":    "false",
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

	// Settings & Auth Endpoints
	http.HandleFunc("/api/settings", handleSettings)
	http.HandleFunc("/api/auth/check", handleAuthCheck)
	http.HandleFunc("/api/auth/verify", handleAuthVerify)
	http.HandleFunc("/api/timezones", handleTimezones)

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
	Jitter         float64 `json:"jitter"`
	MinPing        float64 `json:"min_ping"`
	MaxPing        float64 `json:"max_ping"`
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
		INSERT INTO lan_history (ip_address, mac_address, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, ip, mac, req.Ping, req.Jitter, req.MinPing, req.MaxPing, req.DownloadMbps, req.UploadMbps)
	
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
	ID           int     `json:"id"`
	IPAddress    string  `json:"ip_address"`
	MACAddress   string  `json:"mac_address"`
	PingMs       float64 `json:"ping_ms"`
	JitterMs     float64 `json:"jitter_ms"`
	MinPingMs    float64 `json:"min_ping_ms"`
	MaxPingMs    float64 `json:"max_ping_ms"`
	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	TestDate     string  `json:"test_date"`
	RawDate      string  `json:"raw_date"`
}

func handleLANHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, ip_address, mac_address, ping_ms, jitter_ms, min_ping_ms, max_ping_ms, download_mbps, upload_mbps, test_date FROM lan_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to fetch LAN history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []LANHistory
	for rows.Next() {
		var record LANHistory
		var rawDate string
		if err := rows.Scan(&record.ID, &record.IPAddress, &record.MACAddress, &record.PingMs, &record.JitterMs, &record.MinPingMs, &record.MaxPingMs, &record.DownloadMbps, &record.UploadMbps, &rawDate); err != nil {
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
	JitterMs     float64 `json:"jitter_ms"`
	MinPingMs    float64 `json:"min_ping_ms"`
	MaxPingMs    float64 `json:"max_ping_ms"`
	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	TestDate     string  `json:"test_date"`
	RawDate      string  `json:"raw_date"`
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

func handleTimezones(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allTimezones)
}

var allTimezones = []string{
	"UTC",
	"Africa/Abidjan", "Africa/Accra", "Africa/Addis_Ababa", "Africa/Algiers", "Africa/Asmara",
	"Africa/Bamako", "Africa/Bangui", "Africa/Banjul", "Africa/Bissau", "Africa/Blantyre",
	"Africa/Brazzaville", "Africa/Bujumbura", "Africa/Cairo", "Africa/Casablanca", "Africa/Ceuta",
	"Africa/Conakry", "Africa/Dakar", "Africa/Dar_es_Salaam", "Africa/Djibouti", "Africa/Douala",
	"Africa/El_Aaiun", "Africa/Freetown", "Africa/Gaborone", "Africa/Harare", "Africa/Johannesburg",
	"Africa/Juba", "Africa/Kampala", "Africa/Khartoum", "Africa/Kigali", "Africa/Kinshasa",
	"Africa/Lagos", "Africa/Libreville", "Africa/Lome", "Africa/Luanda", "Africa/Lubumbashi",
	"Africa/Lusaka", "Africa/Malabo", "Africa/Maputo", "Africa/Maseru", "Africa/Mbabane",
	"Africa/Mogadishu", "Africa/Monrovia", "Africa/Nairobi", "Africa/Ndjamena", "Africa/Niamey",
	"Africa/Nouakchott", "Africa/Ouagadougou", "Africa/Porto-Novo", "Africa/Sao_Tome", "Africa/Tripoli",
	"Africa/Tunis", "Africa/Windhoek",
	"America/Adak", "America/Anchorage", "America/Anguilla", "America/Antigua", "America/Araguaina",
	"America/Argentina/Buenos_Aires", "America/Argentina/Catamarca", "America/Argentina/Cordoba", "America/Argentina/Jujuy", "America/Argentina/La_Rioja",
	"America/Argentina/Mendoza", "America/Argentina/Rio_Gallegos", "America/Argentina/Salta", "America/Argentina/San_Juan", "America/Argentina/San_Luis",
	"America/Argentina/Tucuman", "America/Argentina/Ushuaia", "America/Aruba", "America/Asuncion", "America/Atikokan",
	"America/Bahia", "America/Bahia_Banderas", "America/Barbados", "America/Belem", "America/Belize",
	"America/Blanc-Sablon", "America/Boa_Vista", "America/Bogota", "America/Boise", "America/Cambridge_Bay",
	"America/Campo_Grande", "America/Cancun", "America/Caracas", "America/Cayenne", "America/Cayman",
	"America/Chicago", "America/Chihuahua", "America/Costa_Rica", "America/Creston", "America/Cuiaba",
	"America/Curacao", "America/Danmarkshavn", "America/Dawson", "America/Dawson_Creek", "America/Denver",
	"America/Detroit", "America/Dominica", "America/Edmonton", "America/Eirunepe", "America/El_Salvador",
	"America/Fort_Nelson", "America/Fortaleza", "America/Glace_Bay", "America/Goose_Bay", "America/Grand_Turk",
	"America/Grenada", "America/Guadeloupe", "America/Guatemala", "America/Guayaquil", "America/Guyana",
	"America/Halifax", "America/Havana", "America/Hermosillo", "America/Indiana/Indianapolis", "America/Indiana/Knox",
	"America/Indiana/Marengo", "America/Indiana/Petersburg", "America/Indiana/Tell_City", "America/Indiana/Vevay", "America/Indiana/Vincennes",
	"America/Indiana/Winamac", "America/Inuvik", "America/Iqaluit", "America/Jamaica", "America/Juneau",
	"America/Kentucky/Louisville", "America/Kentucky/Monticello", "America/Kralendijk", "America/La_Paz", "America/Lima",
	"America/Los_Angeles", "America/Lower_Princes", "America/Maceio", "America/Managua", "America/Manaus",
	"America/Marigot", "America/Martinique", "America/Matamoros", "America/Mazatlan", "America/Menominee",
	"America/Merida", "America/Metlakatla", "America/Mexico_City", "America/Miquelon", "America/Moncton",
	"America/Monterrey", "America/Montevideo", "America/Montserrat", "America/Nassau", "America/New_York",
	"America/Nipigon", "America/Nome", "America/Noronha", "America/North_Dakota/Beulah", "America/North_Dakota/Center",
	"America/North_Dakota/New_Salem", "America/Nuuk", "America/Ojinaga", "America/Panama", "America/Pangnirtung",
	"America/Paramaribo", "America/Phoenix", "America/Port-au-Prince", "America/Port_of_Spain", "America/Porto_Velho",
	"America/Puerto_Rico", "America/Punta_Arenas", "America/Rainy_River", "America/Rankin_Inlet", "America/Recife",
	"America/Regina", "America/Resolute", "America/Rio_Branco", "America/Santarem", "America/Santiago",
	"America/Santo_Domingo", "America/Sao_Paulo", "America/Scoresbysund", "America/Sitka", "America/St_Barthelemy",
	"America/St_Johns", "America/St_Kitts", "America/St_Lucia", "America/St_Thomas", "America/St_Vincent",
	"America/Swift_Current", "America/Tegucigalpa", "America/Thule", "America/Thunder_Bay", "America/Tijuana",
	"America/Toronto", "America/Tortola", "America/Vancouver", "America/Whitehorse", "America/Winnipeg",
	"America/Yakutat", "America/Yellowknife",
	"Antarctica/Casey", "Antarctica/Davis", "Antarctica/DumontDUrville", "Antarctica/Mawson", "Antarctica/McMurdo",
	"Antarctica/Palmer", "Antarctica/Rothera", "Antarctica/Syowa", "Antarctica/Troll", "Antarctica/Vostok",
	"Asia/Aden", "Asia/Almaty", "Asia/Amman", "Asia/Anadyr", "Asia/Aqtau",
	"Asia/Aqtobe", "Asia/Ashgabat", "Asia/Atyrau", "Asia/Baghdad", "Asia/Bahrain",
	"Asia/Baku", "Asia/Bangkok", "Asia/Barnaul", "Asia/Beirut", "Asia/Bishkek",
	"Asia/Brunei", "Asia/Chita", "Asia/Choibalsan", "Asia/Colombo", "Asia/Damascus",
	"Asia/Dhaka", "Asia/Dili", "Asia/Dubai", "Asia/Dushanbe", "Asia/Famagusta",
	"Asia/Gaza", "Asia/Hebron", "Asia/Ho_Chi_Minh", "Asia/Hong_Kong", "Asia/Hovd",
	"Asia/Irkutsk", "Asia/Jakarta", "Asia/Jayapura", "Asia/Jerusalem", "Asia/Kabul",
	"Asia/Kamchatka", "Asia/Karachi", "Asia/Kathmandu", "Asia/Khandyga", "Asia/Kolkata",
	"Asia/Krasnoyarsk", "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Kuwait", "Asia/Macau",
	"Asia/Magadan", "Asia/Makassar", "Asia/Manila", "Asia/Muscat", "Asia/Nicosia",
	"Asia/Novokuznetsk", "Asia/Novosibirsk", "Asia/Omsk", "Asia/Oral", "Asia/Phnom_Penh",
	"Asia/Pontianak", "Asia/Pyongyang", "Asia/Qatar", "Asia/Qostanay", "Asia/Qyzylorda",
	"Asia/Riyadh", "Asia/Sakhalin", "Asia/Samarkand", "Asia/Seoul", "Asia/Shanghai",
	"Asia/Singapore", "Asia/Srednekolymsk", "Asia/Taipei", "Asia/Tashkent", "Asia/Tbilisi",
	"Asia/Tehran", "Asia/Thimphu", "Asia/Tokyo", "Asia/Tomsk", "Asia/Ulaanbaatar",
	"Asia/Urumqi", "Asia/Ust-Nera", "Asia/Vientiane", "Asia/Vladivostok", "Asia/Yakutsk",
	"Asia/Yangon", "Asia/Yekaterinburg", "Asia/Yerevan",
	"Atlantic/Azores", "Atlantic/Bermuda", "Atlantic/Canary", "Atlantic/Cape_Verde", "Atlantic/Faroe",
	"Atlantic/Madeira", "Atlantic/Reykjavik", "Atlantic/South_Georgia", "Atlantic/St_Helena", "Atlantic/Stanley",
	"Australia/Adelaide", "Australia/Brisbane", "Australia/Broken_Hill", "Australia/Darwin", "Australia/Eucla",
	"Australia/Hobart", "Australia/Lindeman", "Australia/Lord_Howe", "Australia/Melbourne", "Australia/Perth",
	"Australia/Sydney",
	"Europe/Amsterdam", "Europe/Andorra", "Europe/Astrakhan", "Europe/Athens", "Europe/Belgrade",
	"Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Bucharest", "Europe/Budapest",
	"Europe/Busingen", "Europe/Chisinau", "Europe/Copenhagen", "Europe/Dublin", "Europe/Gibraltar",
	"Europe/Guernsey", "Europe/Helsinki", "Europe/Isle_of_Man", "Europe/Istanbul", "Europe/Jersey",
	"Europe/Kaliningrad", "Europe/Kiev", "Europe/Kirov", "Europe/Lisbon", "Europe/Ljubljana",
	"Europe/London", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn",
	"Europe/Minsk", "Europe/Monaco", "Europe/Moscow", "Europe/Oslo", "Europe/Paris",
	"Europe/Podgorica", "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Samara",
	"Europe/San_Marino", "Europe/Sarajevo", "Europe/Saratov", "Europe/Simferopol", "Europe/Skopje",
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
	"Pacific/Noumea", "Pacific/Pago_Pago", "Pacific/Palau", "Pacific/Pitcairn", "Pacific/Pohnpei",
	"Pacific/Port_Moresby", "Pacific/Rarotonga", "Pacific/Saipan", "Pacific/Tahiti", "Pacific/Tarawa",
	"Pacific/Tongatapu", "Pacific/Wake", "Pacific/Wallis",
}
