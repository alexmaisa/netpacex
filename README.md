# NetPaceX ⚡️ `v1.1`

NetPaceX is a lightweight, zero-telemetry network speed testing application optimized for home servers. It is specifically designed to bypass network-wide adblockers and firewalls (such as Pi-hole or OPNsense) that frequently block commercial speed test trackers.

NetPaceX measures two distinct types of network speeds:
1. **Internet (WAN):** Measures the internet speed from the home server to the outside world. This test runs directly from the Go backend to either **Ookla** or **M-Lab (NDT7)** servers, ensuring it is immune to frontend DNS blocking.
2. **Local (LAN):** Measures the speed and latency between your web browser (client) and the local home server hosting NetPaceX. This is completely self-hosted and generates dummy payload data on the fly.

![NetPaceX UI Preview](#) *(Feel free to add a screenshot of the UI here)*

## 🚀 Key Features

- **Dual Testing**: Check both internal WiFi/LAN performance and external ISP internet performance from one dashboard.
- **Multiple Engines**: Choose between **Ookla** and **M-Lab (NDT7)** for your internet speed tests.
- **Scheduled Speed Tests (CRON)**: Automate your speed tests! Set custom schedules using standard Cron expressions for both Internet and LAN tests.
- **Advanced Metrics**: Track not just Speed, but also **Jitter**, **Min Ping**, and **Max Ping** for a deeper understanding of network stability.
- **History & Data Management**: 
    - Full test history with interactive charts.
    - **Allow History Deletion**: Option to remove individual test results (requires `APP_PASSWORD`).
- **Privacy & Security**:
    - **Mask MAC Address**: Protect device identity in logs (requires `APP_PASSWORD`).
    - **APP_PASSWORD Protection**: Sensitive actions and configurations are protected by a secure backend verification flow.
- **Localization & Customization**:
    - Multi-language support (English & Indonesian).
    - **Language Lock**: Administrators can enforce a default language and hide the header language switcher.
    - Comprehensive **Timezone Support** (IANA list).
    - Toggle between **Mbps** and **Gbps** for all metrics.
- **Ultra Lightweight & Modern UI**: 
    - Dependency-free Vanilla JS/CSS frontend with a premium **Glassmorphism** design.
    - **Custom Confirmation Modals**: Beautiful, non-blocking UI dialogs instead of browser default alerts.
- **Go Powered Backend**: High-performance, low-latency execution with SQLite persistence.
- **Ultra-small Footprint**: The generated Docker image is **less than 30MB**, making it incredibly lightweight to deploy and maintain.

## 🛠 Tech Stack
* **Backend:** Go (Golang)
* **Frontend:** Vanilla HTML, CSS, JavaScript
* **Database:** SQLite
* **Deployment:** Docker

## ⚙️ Configuration (.env)

NetPaceX can be configured via environment variables. The easiest way is to create a `.env` file in the root directory.

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_PASSWORD` | Password for sensitive actions (Mask MAC, Delete History) | (Empty) |
| `TZ` | System timezone (e.g., `Asia/Jakarta`) | `UTC` |
| `PORT` | Port the application runs on inside the container | `8080` |
| `WAN_ENGINE` | Speed test engine to use (`ookla` or `mlab`) | `ookla` |

### Example `.env` file:
```bash
APP_PASSWORD=your_secure_password
TZ=Asia/Jakarta
```

## 📦 Installation & Running

### 1. Using Pre-built Image (Recommended)

The easiest way to run NetPaceX is by using our official image from the GitHub Container Registry (GHCR).

1. Download the `docker-compose.yml` file or clone this repo.
2. Create your `.env` file from the example:
   ```bash
   cp .env.example .env
   # Edit .env with your preferred password and timezone
   ```
3. Start the application:
   ```bash
   docker compose up -d
   ```
4. Access the UI at `http://<your-server-ip>:8080`.

### 2. Building from Source

If you want to modify the code or build your own image locally:

1. Clone this repository:
   ```bash
   git clone https://github.com/alexmaisa/NetPaceX.git
   cd NetPaceX
   ```
2. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```
3. Start using the build-focused compose file:
   ```bash
   docker compose -f docker-compose.build.yml up -d --build
   ```

*(Note: For the most accurate WAN results without Docker NAT overhead, add `network_mode: host` to your compose file.)*

### Manual Development Setup

1. Ensure you have Go 1.25+ installed.
2. Clone the repository and navigate to the directory.
3. Install dependencies:
   ```bash
   go mod tidy
   ```
4. Run the Go server:
   ```bash
   go run main.go
   ```
5. Access the UI at `http://localhost:8080`.

## 🤝 Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. 
**Please note that all project communications, issues, pull requests, commit messages, and code comments must be written in English.**

## 📜 License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** License.
You are free to share and adapt the material for non-commercial purposes, provided you give appropriate credit.
See the [LICENSE](LICENSE) file for more information.
