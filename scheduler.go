package main

import (
	"log"

	"github.com/robfig/cron/v3"
)

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
