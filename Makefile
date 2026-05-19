# Makefile for NetPaceX

.PHONY: help dev build clean stop

# Default target when running just 'make'
help:
	@echo "NetPaceX Make Utility"
	@echo "====================="
	@echo "Available commands:"
	@echo "  make dev    - Build frontend and run the Go backend on localhost"
	@echo "  make build  - Build the production multi-stage Docker image"
	@echo "  make clean  - Clean the local SQLite history databases"
	@echo "  make stop   - Stop all NetPaceX-related processes and free up ports"
	@echo "  make help   - Show this help message"

dev:
	@echo "Starting NetPaceX development servers in parallel..."
	@echo "Go Backend: http://localhost:8080"
	@echo "Vite Frontend (with Auto-Reload): http://localhost:5173"
	@(trap 'kill 0' SIGINT; pnpm run dev & go run . & wait)

build:
	@echo "Building production Docker image 'netpacex:latest'..."
	docker build -t netpacex:latest .

clean:
	@echo "Cleaning database files..."
	rm -f data/history.db history.db *.db

stop:
	@echo "Stopping NetPaceX processes and freeing ports (8080, 5173)..."
	@# Kill any processes running on port 8080 and 5173
	@PIDS=$$(lsof -t -i:8080 -i:5173 2>/dev/null); \
	if [ ! -z "$$PIDS" ]; then \
		echo "Killing processes on ports 8080/5173: $$PIDS"; \
		kill -9 $$PIDS 2>/dev/null || true; \
	fi
	@# Also kill by process name to be thorough (exact match to protect runner processes)
	@pkill -x "netpacex" 2>/dev/null || true
	@pkill -x "vite" 2>/dev/null || true
	@echo "Processes stopped successfully."
