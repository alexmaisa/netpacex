# Stage 1: Build the frontend assets
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend

# Install pnpm
RUN npm install -g pnpm

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy frontend source files and build
COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
COPY public/ ./public/
RUN pnpm run build

# Stage 2: Build the Go backend
FROM golang:1.25-alpine AS builder
WORKDIR /app

# Download Go dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy backend source code
COPY . .

# Copy built frontend assets from Stage 1 into the Go build directory
COPY --from=frontend-builder /frontend/static ./static

# Build the Go app statically
# CGO_ENABLED=0 ensures a fully static binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o netpacex .

# Stage 3: Final runtime environment
FROM alpine:latest
WORKDIR /app

# Install timezone data so the TZ environment variable is supported
RUN apk add --no-cache tzdata

# Copy the binary from the builder stage
COPY --from=builder /app/netpacex .

# Copy the static frontend files
COPY --from=builder /app/static ./static

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

# Expose the application port
EXPOSE 8080

# Run the executable
CMD ["./netpacex"]
