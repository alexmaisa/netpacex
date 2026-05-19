# Makefile for NetPaceX

.PHONY: help dev build clean

# Default target when running just 'make'
help:
	@echo "NetPaceX Make Utility"
	@echo "====================="
	@echo "Available commands:"
	@echo "  make dev    - Build frontend and run the Go backend on localhost"
	@echo "  make build  - Build the production multi-stage Docker image"
	@echo "  make clean  - Clean the local SQLite history databases"
	@echo "  make help   - Show this help message"

dev:
	@echo "Building frontend production assets..."
	pnpm run build
	@echo "Starting Go backend server..."
	go run .

build:
	@echo "Building production Docker image 'netpacex:latest'..."
	docker build -t netpacex:latest .

clean:
	@echo "Cleaning database files..."
	rm -f data/history.db history.db *.db
