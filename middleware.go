package main

import (
	"net/http"
	"time"
)

func securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.speedtest.net;")
		next.ServeHTTP(w, r)
	})
}

func rateLimitMiddleware(next http.HandlerFunc, duration time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)
		lastRequest, exists := rateLimitMap[ip]
		if exists && time.Since(lastRequest) < duration {
			http.Error(w, "Too many requests. Please slow down.", http.StatusTooManyRequests)
			return
		}
		rateLimitMap[ip] = time.Now()
		next.ServeHTTP(w, r)
	}
}
