# IStream

IStream is a Windows 10 private-LAN remote gaming/desktop streaming project. It now includes a first working video/system-audio stream over WebRTC in addition to its secure connectivity control plane. Remote keyboard and mouse input are deliberately not part of this release yet.

## What works now

- One application can initiate or receive connections, with **View remote PC** and **Share this PC** directions.
- UDP multicast discovery on `239.255.77.77:47777`, immediate refresh/probe, seven-second offline expiry, and manual private-IPv4 connection.
- TCP control service on `47778`, automatically trying through `47788` if needed.
- Persistent Ed25519 device identity and requester/stream-direction-specific, 30-day inbound trust with an X control to clear it immediately.
- Ephemeral X25519 session key agreement, mutual signed handshake, AES-256-GCM control messages, monotonic replay counters, and a six-digit verification code for a new, cleared, expired, or opposite-direction requester.
- The requester waits with the code; the requested PC must enter it once to grant that requester and stream direction 30 days of trust. The same requester and direction reconnect without a code; changing requester or stream direction needs a new code, while in-session reversal requires an explicit prompt on the other PC.
- Trusted computers remain visible in grey while offline; encrypted health checks run during pending approval so an offline peer closes the request automatically.
- Atomically persisted and validated streaming policy settings.
- Continuous per-instance diagnostic recording with a rolling ten-minute in-memory history and a 10,000-record burst guard.
- Loopback-only NDJSON diagnostics for command-line inspection and encrypted, on-demand peer-history retrieval.
- Electron context isolation and a narrow preload API. Renderer code has no Node.js or socket access.
- Centralized plain-language UI errors for pairing codes, connectivity, discovery, diagnostics, settings, and startup; technical causes remain available to local diagnostics and developer logs.
- Automated enforcement that TypeScript/TSX source has no module-scope functions or variables.
- Primary-display capture and Windows system-audio loopback on the sharing PC, with video/audio playback and a full-screen viewer on the receiving PC.
- LAN-only WebRTC media with SDP and ICE candidates carried through the authenticated AES-256-GCM control channel; no STUN, TURN, cloud relay, or internet service is configured.
- H.264 preference for GTX 1060-class compatibility, profile-controlled bitrate/FPS targets, resolution-preserving congestion preference, and automatic ICE restart after an interrupted media path.
- Live WebRTC metrics for resolution, FPS, video/audio bitrate, loss, jitter, jitter-buffer delay, media RTT, encode/decode time, dropped frames, freezes, codec/implementation, and an explicitly estimated image-path delay.

## Run it

```powershell
npm.cmd install
npm.cmd run dev
```

Run the application on both PCs. Windows may ask whether to permit local network access. To install explicit inbound rules restricted to the Windows **Private** profile and `LocalSubnet`, open PowerShell as Administrator and run:

```powershell
npm.cmd run firewall:install-private
```

Do not enable these rules on a Windows Public network profile. IStream rejects public/manual destinations in the application as an additional boundary; the firewall remains the network enforcement layer.

## Verify it

```powershell
npm.cmd test
npm.cmd run build
```

The integration suite runs two independent services, rejects a wrong code, verifies directional trusted reconnection and opposite-direction code entry, clears trust, retains offline trusted peers, reverses direction after remote consent, transfers large encrypted diagnostic batches, records failures, detects an offline peer while waiting, and verifies that technical failures are converted to actionable UI messages. The production build is written to `out/`.

## Command-line diagnostics

The application shows the exact commands and selected loopback port in its **Command-line record access** panel. The preferred address is `http://127.0.0.1:47800`; ports through `47810` are tried if it is occupied.

```powershell
# Read the retained records on this PC once
curl.exe http://127.0.0.1:47800/snapshot

# Follow this PC's records as newline-delimited JSON until Ctrl+C
curl.exe -N http://127.0.0.1:47800/stream

# Ask the connected peer to transmit its retained local records now
curl.exe http://127.0.0.1:47800/peer/snapshot

# Limit the on-demand peer transfer
curl.exe "http://127.0.0.1:47800/peer/snapshot?limit=25"
```

Each instance records its own one-second connection samples locally while connected and retains the latest ten minutes. The permanent encrypted control line carries a diagnostic request only on demand, then returns records in bounded chunks. A default peer pull allows 1,000 records, enough for the complete ten-minute window at the baseline one-second sampling rate. This prevents background diagnostic history from competing continuously with game traffic. Retrieved peer records are also published into the requester's local `/stream`.

Encrypted diagnostic envelopes accept the bounded multi-record batches produced by the protocol, and every session closure records its reason and previous state before sampling stops. This keeps a failed or closed connection from leaving a misleading final `connected` record.

The diagnostic schema includes state, direction/role, RTT, connection age, health-check backlog, control frame/byte counts, encrypted-message counts, and origin/time metadata. While media is connected, each endpoint also records `media.sample` once per second with bitrate, FPS, resolution, codec, encoder/decode time, media RTT, jitter, jitter-buffer delay, loss, dropped/frozen frames, and implementation/quality-limitation information.

The displayed image-path delay is an estimate composed from half the measured media RTT plus available jitter-buffer and local encode/decode time. It deliberately does not claim true glass-to-glass delay because capture, remote processing, display queueing, and scan-out are not all observable from one WebRTC endpoint. A later visual timecode/photodiode qualification mode is required for authoritative end-to-end latency.

Diagnostics never contain keystrokes, mouse contents, pairing verification codes, private identity keys, session keys, authentication tags, or decrypted media. The HTTP reader binds only to `127.0.0.1`, so it is not exposed to the LAN and needs no firewall rule.

## Media behavior and current boundary

Choose **View** on the PC that should receive the remote screen, or **Share** on the PC whose screen should be sent. After pairing/approval, streaming starts automatically. The Share side captures its primary display and Windows loopback audio; the View side shows both in the Live media panel.

This first media implementation uses Electron/Chromium WebRTC. It is useful for proving real end-to-end capture, encrypted negotiation, LAN transport, playback, direction reversal, and reconnect behavior. WebRTC is asked to maintain resolution and reduce delivery rate under congestion, but Chromium remains responsible for its internal congestion controller. Protected or hardware-overlay content can still appear black, and this stage does not yet provide the deterministic Windows Graphics Capture/DXGI + NVENC latency path needed for final competitive-gaming qualification.

Keyboard and mouse translation remains disabled at the implementation level even if the future-input policy is visible in configuration.

## Process architecture

Electron is the UI and orchestration layer. It owns discovery, pairing state, configuration, consent UI, and the current WebRTC media baseline. The final deterministic capture/NVENC path and keyboard/mouse translation belong in a separate signed native sidecar process behind `MediaEngine`.

A sidecar is preferred over importing streaming DLLs into Electron because GPU-driver faults, capture stalls, and input-hook errors must not crash or corrupt the UI process. It also allows the native real-time threads to avoid Chromium scheduling and garbage collection. Packaging can still feel like one product: the sidecar executable and its DLLs are installed beside the Electron application and launched/monitored internally.

The native boundary is declared in `src/main/media/MediaEngine.ts`. The WebRTC path works without that sidecar and provides a functional fallback for ordinary desktop/game capture.

## Next implementation boundary

The native engine must add Windows Graphics Capture/DXGI capture, explicit NVENC control, measured low-latency decode/render, and SendInput-based translation. The final adaptation controller must apply bitrate reduction first, then frame-rate reduction, then either hold the last valid 720p-or-better frame and reconnect or temporarily allow sub-HD according to the saved configuration.

See [implementation status](docs/implementation-baseline.md), [architecture research](docs/research/lan-streaming-architecture.md), and [configuration specification](docs/research/configuration-specification.md).

## Build and GitHub publishing

`npm run dist` builds the one-click, per-user NSIS installer, copies it to the project root, removes older root-level IStream installers, synchronizes reviewed source changes to `main`, and publishes `v<package.json version>` as the latest GitHub Release. The release contains the installer, block map, `latest.yml`, and SHA-256 checksums.

Publishing requires the expected `Hagryph/IStream` origin, the `main` branch, a clean working tree synchronized with `origin/main`, and an authenticated GitHub CLI. Rebuilding the same commit replaces that release's assets. If the version tag already belongs to a different commit, publishing stops and requires a version bump instead of moving a released tag.

For a deliberately local package build, set `ISTREAM_SKIP_GITHUB_SYNC=1` and `ISTREAM_SKIP_GITHUB_RELEASE=1` before running `npm run dist`.

## License

IStream-owned source code and documentation are publicly source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Commercial use of IStream-owned code, including commercial use of modified portions, is not granted.

This is not an OSI-approved open-source license because it restricts commercial use. Third-party components remain under their own licenses and are not relicensed or restricted by IStream; see [third-party notices](THIRD_PARTY_NOTICES.md) and the generated [dependency license report](docs/legal/dependency-license-report.json).
