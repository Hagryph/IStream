# Minimum baseline implementation status

## Delivered

The application is a single Electron product in which every instance can be host or client. UI and networking are separate modules connected by typed, context-isolated IPC.

The secure control path is fully operational for the baseline:

1. The TCP initiator sends a signed device identity plus ephemeral X25519 key.
2. The receiver validates it and returns its own signed identity and ephemeral key.
3. Both derive directional AES-256-GCM keys and the same six-digit short authentication string.
4. Both users approve the new device. A successful identity is pinned atomically.
5. Encrypted counters prevent replay; encrypted ping/pong frames report RTT and detect interruption.
6. Direction reversal is an encrypted request and is applied only after remote consent.

Discovery is link-local in behavior: multicast TTL is one, beacons contain no secrets, and manual destinations must be RFC1918 IPv4 or loopback. An identity spoof in a discovery beacon cannot complete the signed handshake. The optional firewall script narrows inbound access to the Windows Private profile and local subnet.

The baseline configuration is usable and persisted. It defaults to:

- Gaming preset
- H.264/NVENC compatibility target for GTX 1060-class hardware
- 1920×1080 at 60 FPS, minimum 30 FPS
- 35 Mbps ceiling
- SDR; HDR automatic is opt-in
- Adapt bitrate, then frame rate, then hold the last HD frame/reconnect
- Keyboard/mouse policy enabled
- Application safety lock enabled for League of Legends executables

## Diagnostic recording and on-demand transfer

Every connected instance records a structured connection sample once per second into its own memory ring. It retains the latest ten minutes, with a separate 10,000-record safety cap for unexpected event bursts. Recording is local and continues for the session without creating continuous bulk telemetry traffic between peers.

The local diagnostics reader is an HTTP service bound exclusively to `127.0.0.1`. It exposes:

- `/snapshot` for retained local and already-requested remote records
- `/stream` for permanent newline-delimited JSON output suitable for `curl.exe -N`
- `/peer/snapshot` to request the connected peer's locally retained records on demand
- `/health` for a minimal reader health check

An on-demand peer request is an authenticated encrypted control message. The peer selects only locally originated diagnostic records and returns them in bounded chunks. The default request permits 1,000 records, covering the full ten-minute window at the baseline one-second rate; an explicit request can ask for up to 5,000. Each record is schema-validated before acceptance. Late replies are ignored, oversized batches are rejected, and a request times out after ten seconds.

The loopback reader deliberately has no LAN binding or CORS access. Diagnostic producers are prohibited from emitting input contents, pairing codes, private keys, derived session keys, authentication material, or decoded media contents.

## Deliberate native boundary

No browser capture API is used. Browser/Electron display capture can return protected-content black frames and does not provide the deterministic low-latency path needed for gaming. The next stage belongs in a separate native Windows sidecar using Windows Graphics Capture with DXGI fallback and NVENC.

This also answers the DLL/process packaging decision: keep React/Electron free of capture, codec, driver, and input DLLs. The main process talks to a supervised native executable through a restricted local IPC channel. The executable and required DLLs can still be included inside the installer, so users do not manually assemble dependencies.

## Not yet implemented

- Video/audio capture, encoding, transport, decode, presentation, and A/V synchronization
- Freeze-last-HD-frame media behavior and automatic media-session resumption
- Keyboard/mouse injection, stuck-key cleanup, and protected-application enforcement
- HDR capability negotiation and HDR-to-SDR fallback
- Encoder capability probing and GTX 1060 mobile/desktop performance qualification
- Installer-time native sidecar deployment and Windows code signing

The existing `MediaEngine` interface is the seam for these components. Connectivity and configuration tests must remain independent of the native engine so the control plane continues to be testable without GPU hardware.
