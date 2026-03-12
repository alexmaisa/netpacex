package main

import (
	"database/sql"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

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
		"timezone":        "UTC",
		"wan_unit":        "Mbps",
		"lan_unit":        "Mbps",
		"mask_mac":        "true",
		"allow_delete":    "false",
		"default_lang":    "en",
		"lock_lang":       "false",
		"cron_wan_enable": "false",
		"cron_wan_expr":   "0 * * * *",
		"cron_lan_enable": "false",
		"cron_lan_expr":   "30 * * * *",
		"cron_lan_target": "",
		"wan_engine":      "mlab",
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
