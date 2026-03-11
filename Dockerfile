# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the Go app statically
# CGO_ENABLED=0 ensures a fully static binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o netpacex .

# Final stage
FROM alpine:latest

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/netpacex .

# Copy the static frontend files
COPY --from=builder /app/static ./static

# Expose the application port
EXPOSE 8080

# Run the executable
CMD ["./netpacex"]
