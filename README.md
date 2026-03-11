# NetPace ⚡️

NetPace is a lightweight, zero-telemetry network speed testing application optimized for home servers. It is specifically designed to bypass network-wide adblockers and firewalls (such as Pi-hole or OPNsense) that frequently block commercial speed test trackers.

NetPace measures two distinct types of network speeds:
1. **LAN Speed (Client -> Server):** Measures the speed and latency between your web browser (client) and the local home server hosting NetPace. This is completely self-hosted and generates dummy payload data on the fly.
2. **WAN Speed (Server -> Internet):** Measures the internet speed from the home server to the outside world. This test runs directly from the Go backend to Ookla servers, ensuring it is immune to frontend DNS blocking.

![NetPace UI Preview](#) *(Feel free to add a screenshot of the UI here)*

## Features
- **Dual Testing**: Check both internal WiFi/LAN performance and external ISP internet performance from one dashboard.
- **Ultra Lightweight**: Built with a Go backend and a dependency-free Vanilla JS/CSS frontend.
- **Pi-hole / OPNsense Friendly**: Zero third-party frontend trackers. WAN tests are executed securely on the server side.
- **Modern UI**: Dark mode, glassmorphism design with smooth animations.
- **Tiny Footprint**: The provided Docker image is built from scratch/alpine and uses very little memory.

## Tech Stack
* **Backend:** Go (Golang)
* **Frontend:** Vanilla HTML, CSS, JavaScript (No build tools required)
* **Deployment:** Docker

## Installation & Running

The easiest way to run NetPace is using Docker Compose.

1. Clone this repository:
   ```bash
   git clone https://github.com/alexmaisa/netpace.git
   cd netpace
   ```

2. Start the container:
   ```bash
   docker-compose up -d
   ```

3. Open your web browser and navigate to:
   ```
   http://<your-server-ip>:8080
   ```

*(Note: If you want the WAN speedtest to measure your exact host interface speed without Docker's NAT overhead, you can add `network_mode: host` to your `docker-compose.yml`.)*

## Manual Development Setup

If you wish to run the project locally without Docker:

1. Ensure you have Go 1.24+ installed.
2. Clone the repository and navigate to the directory.
3. Run the Go server:
   ```bash
   go run main.go
   ```
4. Access the UI at `http://localhost:8080`.

## Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. 
**Please note that all project communications, issues, pull requests, commit messages, and code comments must be written in English.**

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** License.
You are free to share and adapt the material for non-commercial purposes, provided you give appropriate credit.
See the [LICENSE](LICENSE) file for more information.
