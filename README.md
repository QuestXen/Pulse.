# Pulse.

> **Sync your voice. Anywhere.**

Pulse is a direct-connect voice interface designed for those who value privacy and performance. We built this application to demonstrate that high-fidelity audio does not require heavy servers or invasive data collection.

### The Philosophy

Most modern communication tools route your data through central architectures, introducing latency and privacy risks. Pulse takes a different approach. We utilize WebRTC to establish a true Peer-to-Peer connection. This means your audio stream travels directly from your machine to your contact's device. No middleman, no recording, no metadata storage. It is just a secure pipe between two points.

### Architecture & Tech

We deliberately chose **Tauri v2** over Electron to respect your system's resources. By leveraging a **Rust** backend, we handle cryptographic operations and system events with native performance, keeping the application footprint exceptionally small.

On the frontend, we stripped away complex frameworks. The interface is built with **Vanilla TypeScript**, ensuring that every interaction—from the fluid 60fps audio visualizer to the glass-morphism UI—responds instantly. The result is a specialized tool that feels native, robust, and incredibly fast.

### Getting Started

To build Pulse from source, you need a Rust environment and Node.js.

```bash
# Clone and install dependencies
git clone https://github.com/yourusername/pulse.git
cd pulse
pnpm install

# Run in development mode
pnpm tauri dev

# Build a production binary
pnpm tauri build
```

---

© 2026 Pulse. Distributed under the MIT License.
