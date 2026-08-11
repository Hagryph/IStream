# IStream configuration model and stable baselines

Status: initial implementation specification, 11 August 2026

This document defines how IStream should expose extensive control without requiring users to understand codecs, rate control, WebRTC, or GPU memory. It complements `lan-streaming-architecture.md`.

The central rule is: **Auto must be a complete, tested configuration, not an absence of configuration.** Advanced settings override individual parts of a versioned preset, while safety, hardware capability, peer compatibility, and network admission remain hard constraints.

## 1. Configuration experience

### 1.1 Recommended view

The default Share screen contains only these decisions:

| Control | Choices | Default | Plain-language description |
|---|---|---|---|
| Usage | Game / Desktop | Game | Game protects frame pacing and at least 30 fps. Desktop protects text clarity. |
| Quality | Auto / 1080p / 900p / 720p / Custom | Auto | Auto runs a five-second link and hardware check, then starts the highest stable tier. |
| Frame rate | Auto / 60 / 30 | Auto | Game tries 60 and never runs below 30. Desktop may reduce frame rate for static content. |
| HDR | Auto / Native / SDR | Auto | Native is used only when capture, HEVC Main10, receiver, and display are all HDR-capable. |
| Connection behavior | Adaptive / Quality Lock | Adaptive | Adaptive changes bitrate/tier. Quality Lock freezes and reconnects instead of changing the selected tier. |
| Keyboard and mouse | Ask every time / Allow / View only | Ask every time | Competitive-game Safety Lock always overrides this to View only. |

Below the controls, show one resolved summary before Start:

> Recommended: Game · 1080p60 · H.264 NVENC · 16 Mbit/s target · 70 ms latency target · Adaptive

If Auto selects a lower tier, explain why in one sentence, for example:

> 720p60 selected because stable Wi-Fi goodput was 21 Mbit/s; 1080p60 requires 30 Mbit/s headroom.

### 1.2 Advanced and Expert views

Advanced is grouped by Capture, Video, Adaptation, Network, Audio, Input, Safety, and Diagnostics. Every field shows:

- a human label and one-sentence description;
- the preset value, requested value, and effective value;
- impact badges: Latency, Quality, Bandwidth, GPU, Compatibility, or Stability;
- whether a change is Live, Keyframe, Reconnect, or App restart;
- supported range reported by the active encoder, not just a hard-coded range;
- Reset this setting and Reset entire profile actions.

Expert exposes raw codec-specific controls only after an `I understand this can make the stream unstable` confirmation. Invalid combinations are rejected with a reason; they are never silently accepted.

## 2. Resolution order and scopes

Settings resolve in this order, from strongest to weakest:

1. Safety policy, including Game Safety Lock and protected-content restrictions.
2. Actual local hardware/driver capability.
3. Remote decoder, display, and protocol capability.
4. Network preflight/admission limit.
5. Selected versioned preset.
6. Per-application override.
7. Per-device override.
8. Global user override.
9. Runtime adaptation within the resulting allowed envelope.

The UI must always distinguish:

- **Requested:** what the user selected.
- **Effective at start:** the result of capability negotiation and admission.
- **Current:** the value after runtime adaptation.
- **Reason:** the rule that changed it.

Configuration scopes:

| Scope | Examples |
|---|---|
| Global | UI language, default profile, local escape chord, preferred interface |
| Peer | trusted input permission, preferred monitor, audio device |
| Application | Game/Desktop profile, Capture Lock, Safety Lock, HDR preference |
| Session only | temporary source, mute, Quality Lock, diagnostics overlay |

Safety and pairing secrets are not exportable with ordinary profile files.

## 3. Encoder and decoder Auto selection

Auto selection performs real pipeline probes on both endpoints and caches the result against GPU LUID, driver version, GStreamer version, and IStream build.

### 3.1 Encoder ranking

1. Require hardware encode for Game mode. If no hardware path passes, refuse the performance guarantee rather than silently starting software encoding.
2. Prefer an encoder that consumes `D3D11Memory` on the same adapter as capture. Avoid a D3D11-to-system-memory download or cross-adapter copy.
3. On NVIDIA, prefer `nvd3d11h264enc` for SDR and `nvd3d11h265enc` with P010/Main10 for native HDR.
4. On AMD, probe `amfh264enc`/`amfh265enc`; on Intel, probe `qsvh264enc`/`qsvh265enc`. Map the common policy to vendor-specific properties rather than exposing one vendor's labels on another.
5. Use `mfh264enc` only as a measured hardware fallback when the vendor element fails but Media Foundation remains D3D11-aware and meets latency/reconfiguration tests.
6. Consider hardware AV1 only on newer hardware when both peers support it and a benchmark shows worthwhile bitrate savings without violating the latency budget.
7. Allow a software fallback only in Desktop Best effort mode, initially capped at 720p30. Never silently use it for Game.

### 3.2 Decoder ranking

1. Prefer `d3d11h264dec` or `d3d11h265dec` on the adapter that owns the viewport.
2. Require Main10 output and a 10-bit presentation path for native HDR.
3. Reject a decoder that falls back to system memory when a same-codec D3D11 decoder works.
4. Desktop Best effort may use software decode. Game mode fails admission if decode p95 exceeds its frame budget.

### 3.3 Qualification test

For each candidate pipeline, run a short synthetic high-motion test and record:

- successful caps/profile negotiation;
- D3D11 zero-copy state and any GPU-to-CPU or cross-adapter transfer;
- encode and decode p50/p95/p99;
- frame queue depth and skipped frames;
- bitrate change without restart;
- forced keyframe and reference-loss recovery;
- resolution/fps reconfiguration time;
- 8-bit or Main10 correctness;
- ten-second GPU/game-frame-time impact.

At 60 fps, prefer a candidate with encode p95 at or below 8 ms, decode p95 at or below 5 ms, no persistent queue, and no unexplained game-frame regression. Faster results do not justify worse compatibility if both are safely inside budget.

## 4. Versioned stable presets

The initial preset IDs are immutable once released. Improvements create `v2`; they do not silently alter an existing imported profile.

### 4.1 `game-sdr-stable-v1` — default GTX 1060 baseline

| Setting | Effective baseline | Why |
|---|---|---|
| Capture | WGC, D3D11, SDR NV12 | Supported Windows capture without game hooks; GPU-resident path |
| Encoder | `nvd3d11h264enc` | Direct D3D11 NVENC path on GTX 1060/1060 Mobile |
| Codec/profile | H.264 High, 8-bit 4:2:0, CABAC | Broad hardware compatibility and good low-delay behavior |
| Preset | P4; fall back to P3 if qualification misses budget | P4 starts at the middle quality/performance point |
| Tune | Ultra low latency | Performance and queue control have priority for gaming |
| Rate control | CBR controlled by one IStream congestion controller | Predictable bursts and live bitrate changes |
| Multipass | Disabled | Stable first baseline with minimum extra GPU work |
| B-frames | 0 | No frame reordering delay on Pascal baseline |
| Look-ahead | 0 | No look-ahead queue or additional GPU work |
| Zero latency | Enabled | Explicitly disables reordering delay |
| GOP/IDR | One second (`gop-size = fps`) plus immediate PLI recovery | Bounded recovery and simple diagnostics |
| Sequence headers | Repeat on IDR | Decoder can recover cleanly after loss/restart |
| VBV | One frame, recomputed as `ceil(target kbit/s / fps)` | NVIDIA's low-latency guidance; avoids a hidden encoder queue |
| Spatial AQ | Auto qualification; off when GPU headroom is low, otherwise strength 8 | Quality improvement must not hurt game frame time |
| Temporal AQ | Off | Avoid extra analysis/compute in the stable Pascal path |
| Weighted prediction | Off | Compatibility-first baseline |
| QP limits | Encoder automatic; observe QP instead of hard-clamping | A hard quality clamp can violate the network budget |
| Renderer queue | Latest frame, maximum one queued frame | Prevents latency accumulation |

Initial 1080p60 target is 16 Mbit/s, but actual start bitrate is the lower of the tier target and 55% of stable preflight goodput. The encoder bitrate and one-frame VBV are updated together.

### 4.2 `game-hdr-stable-v1`

This inherits Game SDR latency controls and changes:

| Setting | Effective baseline |
|---|---|
| Capture/transform | FP16 WGC/D3D11 through GPU conversion to P010, without an 8-bit intermediate |
| Encoder | `nvd3d11h265enc` |
| Codec/profile | HEVC Main10, 10-bit 4:2:0 |
| Metadata | BT.2020/PQ, mastering display, MaxCLL/MaxFALL when available |
| Receiver | `d3d11h265dec` to a verified HDR swap chain |
| Fallback | Sender-side tone mapping to `game-sdr-stable-v1` |

Native HDR is an end-to-end state, not just an encoder checkbox. `HDR: Native` is unavailable when any required stage fails. `HDR: Auto` falls back to SDR with an explicit reason.

### 4.3 `desktop-clear-stable-v1`

| Setting | Effective baseline |
|---|---|
| Codec | H.264 hardware by default; HEVC/AV1 only after measured benefit |
| Resolution/fps | Prefer 1080p30; use 60 fps for scrolling/video when admitted |
| Tune/preset | Low latency, P4; no B-frames or look-ahead |
| Rate control | CBR with live adaptation |
| Adaptation | Reduce bitrate, then 60→45→30→20/15 fps, then resolution |
| Chroma | 4:2:0 stable baseline; experimental 4:4:4 only after both endpoints prove support |
| Audio | Generic Opus, 20 ms frames, constrained VBR |

Desktop remains interactive. It does not adopt recording-style multi-second VBV, look-ahead, or reordered B-frames merely to improve compression.

### 4.4 `wifi-resilient-v1`

This is an optional modifier rather than a separate usage profile:

- start one tier below the maximum admitted tier;
- cap media at 45% of stable goodput rather than 55%, reserving approximately 55% for Wi-Fi variation, repair, audio, and control;
- use a 2-3 frame adaptive jitter target instead of 1-2;
- enable RTX/NACK and allow adaptive FEC only when measured loss and remaining headroom justify it;
- require 15 stable seconds before an upshift and a 30-second minimum upshift dwell;
- retain Game's 30 fps floor.

## 5. Initial bitrate and tier table

These are version-1 starting values for high-motion content, not universal codec claims. Preflight and runtime congestion control may use less.

| Tier | H.264 Game target | Allowed adaptive range | Minimum stable goodput to admit |
|---|---:|---:|---:|
| 1920×1080 60 fps | 16 Mbit/s | 10-20 Mbit/s | 30 Mbit/s |
| 1600×900 60 fps | 12 Mbit/s | 8-16 Mbit/s | 23 Mbit/s |
| 1280×720 60 fps | 9 Mbit/s | 6-12 Mbit/s | 17 Mbit/s |
| 1280×720 30 fps | 6 Mbit/s | 4-8 Mbit/s | 11 Mbit/s |
| 960×540 30 fps | 3.5 Mbit/s | 2.5-5 Mbit/s | 7 Mbit/s |
| 854×480 30 fps | 2.5 Mbit/s | 1.5-3.5 Mbit/s | 5 Mbit/s |

HEVC Main10 HDR initially uses the same targets rather than claiming automatic savings on Pascal. Measurements may create a later HDR-specific table. Desktop 1080p30 begins at 10 Mbit/s and 1080p60 at 14 Mbit/s because fine text and colored edges can be harder than expected.

Auto never admits a tier solely from Wi-Fi PHY rate. It uses stable UDP goodput, loss, RTT, jitter, codec benchmark, and display result.

## 6. Advanced video settings

| UI label | Internal/default | Description and validation |
|---|---|---|
| Codec | `auto` | Auto/H.264/HEVC/AV1. Unsupported choices show why and cannot start. |
| Encoder | `auto` | Shows friendly adapter/API and exact GStreamer element in details. Prefer same-adapter D3D11. |
| Hardware only | On for Game | Off is permitted only in Desktop Best effort. |
| Encoder preset | Auto → P4/P3 | P1 is fastest/lower quality; P7 is slowest/higher quality. Qualification can disallow presets that miss budget. |
| Latency tune | Game: ultra-low-latency; Desktop: low-latency | Do not expose deprecated `low-latency-hq/hp` preset names. |
| Rate control | CBR | VBR/constant quality are Expert and incompatible with the standard adaptive controller until tested. |
| Target/min/max bitrate | Tier table | Constrained by preflight, codec, and 55% media cap. Live change. |
| VBV frames | 1 | Range 1-4. Values above 2 show a latency warning in Game. |
| GOP interval | 1000 ms | Range 250-5000 ms. Converted to frames when fps changes. Keyframe-boundary change. |
| B-frames | 0 | Game stable preset locks 0. Expert values require latency/decoder tests. |
| Look-ahead frames | 0 | Game stable preset locks 0. Warn that each buffered frame adds delay and GPU work. |
| Multipass | Disabled | Quarter/full are Expert and enabled only after benchmark. |
| Spatial AQ | Auto | Off/On/Auto; strength 1-15, initial qualified value 8. |
| Temporal AQ | Off | Expert; may consume GPU resources and change bitrate distribution. |
| QP minimum/maximum | Auto | Expert per-frame-type values. Reject invalid min>max. Hard maximum can force bitrate overshoot. |
| Repeat headers | On | Repeat SPS/PPS or VPS/SPS/PPS on IDR for recovery. |
| Pixel format | Auto | NV12 SDR; P010 native HDR. 4:4:4 is experimental and never auto-selected in v1. |
| HDR | Auto | Native requires a valid 10-bit end-to-end chain; SDR tone mapping is always available. |

Only one component controls encoder bitrate. During the high-level `webrtcsink` spike, IStream configures supported bounds/mitigation and lets its congestion controller own bitrate. Production Expert control moves to `webrtcbin`; do not run a second controller fighting `webrtcsink`.

## 7. Capture and quality settings

| Setting | Default | Description |
|---|---|---|
| Capture API | Auto: WGC then DXGI | WGC is preferred. DXGI is a diagnosed fallback for full monitors. GDI is not offered. |
| Source | Ask | Monitor/window. Application Capture Lock pauses rather than leaking another source. |
| Capture cursor | On | Can be hidden for games that render their own cursor. |
| Crop/letterbox | Fit, preserve aspect | Never stretch. Input coordinates use the same transform. |
| Initial tier | Auto | Highest tier that passes admission. |
| Maximum tier | Source up to 1080p60 initially | Avoid accidental 4K load on GTX 1060 until explicitly qualified. |
| Minimum Game tier | 854×480 at 30 fps | Below this, freeze/reconnect. |
| Desktop minimum | 1280×720 preferred; Best effort may go lower | Desktop reduces fps before resolution. |
| Connection behavior | Adaptive | Quality Lock holds the selected tier and freezes when it fails. |
| Local preview | Off during Game by default | Avoid duplicate render/GPU work; preview may be enabled in setup. |

## 8. Adaptation settings

The normal UI exposes only Adaptive or Quality Lock. Advanced exposes bounded policy values:

| Setting | Game baseline | Desktop baseline |
|---|---:|---:|
| Media share of stable goodput | max 55% | max 65% for static content |
| Metrics interval | 250 ms | 500 ms |
| Bad-path hold before down action | 500-750 ms; immediate if queue exceeds one frame | 1000 ms |
| Stable hold before up action | 10 s | 10 s |
| Minimum time after upshift | 30 s | 20 s |
| Render queue maximum | 1 frame | 2 frames |
| FPS floor | 30 | 15/20 for static content |
| Capacity failure at final tier | Freeze/reconnect | Best-effort choice or freeze |

Game action order:

1. Reduce target bitrate within the current tier.
2. If 60 fps cannot remain clean, step 1080p→900p→720p.
3. Step 60→45→30 fps.
4. Preserve 30 fps while stepping 720p→540p→480p.
5. Freeze/reconnect below sustainable 480p30.

Desktop action order:

1. Reduce bitrate.
2. Step 60→45→30→20/15 fps according to content motion.
3. Reduce resolution only after the clarity policy is exhausted.

Expose visual-quality telemetry rather than a misleading percentage slider: encoder QP distribution, bits per pixel, skipped frames, tier changes, and recent reason. Initial warning thresholds such as H.264 p95 QP above 40 or HEVC p95 above 38 are diagnostic hypotheses and must be calibrated before they trigger policy.

## 9. Network and recovery settings

| Setting | Stable default | Description |
|---|---|---|
| Interface | Auto, private Ethernet before Wi-Fi | Public/VPN/virtual/off-subnet candidates remain blocked. |
| Discovery | mDNS plus manual IP | Same LAN only. |
| RTP payload size | approximately 1200 bytes | Avoid IP fragmentation on mixed Ethernet/Wi-Fi. |
| Congestion control | Transport-wide GCC | Required for Adaptive; disabled only in diagnostic tests. |
| NACK/RTX | On | Primary low-RTT repair method. |
| FEC | Auto | Enable only for measured loss when repair headroom remains; never blindly stack overhead during congestion. |
| Jitter target | Game 1-2 frames; Desktop 2-4 | Adaptive within a bounded range. |
| Audio/control priority | Above video enhancement | Keyboard/button transitions and audio must not wait behind obsolete video. |
| UDP port range | Fixed narrow install-configurable range | Private/Local Subnet firewall rule only. |
| DSCP | Off | Expert managed-network option; never required for correctness. |
| Reconnect backoff | 0.25, 0.5, 1, 2, 5 s | Freeze last complete frame and mute stale audio. |

Network Expert settings must include conservative bounds. For example, the UI must not accept an RTP payload larger than the validated MTU envelope or an unbounded jitter buffer.

## 10. Audio settings

| Setting | Game | Desktop |
|---|---|---|
| Codec/rate | Opus, 48 kHz stereo | Opus, 48 kHz stereo |
| Bitrate | 128 kbit/s; range 96-160 | 128 kbit/s; range 96-160 |
| Opus mode | Restricted low delay | Generic audio |
| Frame size | 10 ms | 20 ms |
| Bitrate type | Constrained VBR | Constrained VBR |
| Complexity | 8 initial | 10 initial |
| In-band FEC | Auto above measured loss threshold | Auto above measured loss threshold |
| System audio | On by default | On by default |
| Microphone | Off/ask | Off/ask |

When FEC is enabled, set Opus packet-loss percentage from a smoothed measured value rather than the latest individual report. Audio device changes rebuild only the audio branch.

## 11. Keyboard and mouse settings

| Setting | Default | Description |
|---|---|---|
| Permission | Ask every session | Remembering permission is per paired peer and still overridden by Safety Lock. |
| Keyboard translation | Scan-code/HID mapping | Per-layout remap table for special/media keys. |
| Mouse mode | Auto | Relative in captured games; absolute with DPI/crop transform on desktop. |
| Raw mouse rate | Preserve up to qualified rate | Coalesce obsolete motion only; never key/button transitions. |
| Mouse sensitivity | 1.0 | Applied only to relative motion; visible reset. |
| Escape chord | Local-only fixed safe default, user-remappable | Never sent remotely and cannot be disabled without choosing a replacement. |
| Release on focus loss | On, locked | Prevent stuck input. |
| Periodic state snapshot | On | Repairs a missed transition; sequence-numbered. |
| Elevated-window control | Off | Normal application remains unelevated; UIPI limitation is explained. |
| Virtual HID driver | Not installed | No default kernel/input driver; separate future review only. |

Game Safety Lock closes input channels and releases all state before a configured protected game becomes active. The setting page shows this as a hard policy, not as a failed connection.

## 12. Validation and dependency rules

Examples the configuration resolver must enforce:

- Native HDR requires hardware HEVC Main10 or a future verified 10-bit AV1 path, P010/10-bit decode, HDR display state, and valid metadata handling.
- GTX 1060/1060 Mobile cannot select hardware AV1.
- Game stable presets require hardware encode/decode, zero look-ahead, no reordered B-frames, and a bounded queue.
- Quality Lock disables tier/fps adaptation; it does not disable bitrate accounting, loss repair, or reconnect.
- Game 30 fps floor cannot be edited below 30. Desktop may use 15/20 fps.
- The maximum bitrate cannot exceed the admitted link budget or configured private-interface cap.
- A user-selected encoder on the wrong adapter receives a cross-adapter warning and is rejected when it breaks the latency guarantee.
- Software encode is incompatible with the Game performance guarantee.
- Game Safety Lock overrides any remembered remote-input permission.
- Protected capture is not made available by changing capture API.
- Exactly one bitrate controller owns the encoder at a time.

When a setting becomes invalid after a driver, display, or peer change, retain the requested value for explanation but start from a safe effective fallback. Never rewrite the user's request to pretend it was supported.

## 13. Change lifecycle

| Change class | Examples | Application behavior |
|---|---|---|
| Live | bitrate bounds, audio mute, stats visibility, mouse sensitivity | Apply immediately and report effective value |
| Keyframe boundary | GOP interval, fps step, compatible resolution step | Apply at clean boundary and request IDR |
| Media reconnect | codec, bit depth, HDR mode, incompatible profile | Freeze, renegotiate, keyframe, resume |
| Session restart | interface/port binding, pairing identity | Ask before ending session |
| App restart | GStreamer runtime/plugin change | Installer/developer operation only |

Batch dependent changes into one renegotiation. Do not reconnect once per field when applying a profile.

## 14. Storage and import/export

- Store versioned non-secret settings in `%APPDATA%\IStream\settings.json`.
- Store device identity/private keys separately with Windows protection; never export them with profiles.
- Write atomically through a temporary sibling file and keep one last-known-good backup.
- Validate against a schema before replacing active settings.
- Export sanitized `.istream-profile.json` files containing preset ID and explicit overrides only.
- Include `schemaVersion`, `presetVersion`, application version, and optional human notes.
- Reject a newer unknown schema rather than guessing. Migrate older schemas with logged, testable transforms.
- Provide Reset setting, Reset page, Reset profile, and Safe defaults actions.

Illustrative profile shape:

```json
{
  "schemaVersion": 1,
  "name": "Game - stable auto",
  "presetId": "game-sdr-stable-v1",
  "video": {
    "codec": "auto",
    "encoder": "auto",
    "maxTier": "1080p60",
    "hdr": "auto",
    "preset": "auto",
    "bitrateKbps": "auto"
  },
  "adaptation": {
    "mode": "adaptive",
    "minimumGameTier": "480p30",
    "goodputMediaCapPercent": 55
  },
  "audio": {
    "system": true,
    "microphone": "ask",
    "opusBitrateKbps": 128
  },
  "input": {
    "permission": "ask",
    "mouseMode": "auto"
  }
}
```

Raw GStreamer element names/properties belong in diagnostic snapshots, not portable profiles. Portable settings express intent; the adapter maps that intent to the available vendor element.

## 15. Diagnostics and support output

The live configuration inspector shows:

| Requested | Effective/current | Reason |
|---|---|---|
| Codec: Auto | H.264 High via `nvd3d11h264enc` | GTX 1060 SDR stable baseline |
| Quality: Auto | 1280×720 at 60 fps | Wi-Fi preflight admitted 21 Mbit/s |
| Preset: Auto | P4 / ultra-low-latency | Encode p95 5.2 ms |
| Bitrate: Auto | 9.0 Mbit/s target, 7.6 current | GCC congestion estimate |
| HDR: Auto | SDR | Receiver display HDR disabled |
| Input: Allow | View only | Game Safety Lock active |

Sanitized export includes the effective pipeline, element/property values, GPU LUID/name/driver, zero-copy state, peer capabilities, bitrate history, tier changes/reasons, latency breakdown, and validation warnings. It excludes pixels, audio, keys, pairing secrets, full SDP credentials, and private user paths where possible.

## 16. Configuration acceptance tests

- Safe defaults start successfully on GTX 1060 desktop and GTX 1060 Mobile reference systems.
- A new user can start a recommended stream without opening Advanced.
- Every visible Advanced field has help text, bounds, default, effective value, and change class.
- Every preset expands deterministically into a complete internal configuration.
- Capability loss produces an explained fallback, never an invalid pipeline or silent software Game encoder.
- Applying a profile performs at most one required renegotiation.
- Importing malformed, future, or incompatible profiles cannot crash the UI/native sidecar.
- Reset Safe defaults recovers from every configuration-induced start failure.
- Requested/effective/current values match the actual GStreamer properties and negotiated RTP codec.
- A forced low-bandwidth test follows the selected Game/Desktop ladder and respects Quality Lock.
- Game Safety Lock always wins over profile/imported input permissions.
- Configuration writes survive process interruption without corrupting the last-known-good file.

## Primary sources

- NVIDIA NVENC tuning, presets, CBR, and single-frame VBV guidance: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-video-encoder-api-prog-guide/index.html
- NVIDIA removal of deprecated preset/rate-control names: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/deprecation-notices/index.html
- GStreamer NVIDIA D3D11 H.264 encoder and properties: https://gstreamer.freedesktop.org/documentation/nvcodec/nvd3d11h264enc.html
- GStreamer NVIDIA D3D11 HEVC/Main10 encoder and properties: https://gstreamer.freedesktop.org/documentation/nvcodec/nvd3d11h265enc.html
- GStreamer D3D11 hardware decoders and GPU-memory output: https://gstreamer.freedesktop.org/documentation/d3d11/
- GStreamer WebRTC congestion control, bitrate ownership, mitigation, RTX, and FEC: https://gstreamer.freedesktop.org/documentation/rswebrtc/ and https://gstreamer.freedesktop.org/documentation/rswebrtc/webrtcsink.html
- GStreamer Opus properties: https://gstreamer.freedesktop.org/documentation/opus/opusenc.html
- GStreamer AMD AMF, Intel QSV, and Media Foundation H.264 encoders: https://gstreamer.freedesktop.org/documentation/amfcodec/amfh264enc.html, https://gstreamer.freedesktop.org/documentation/qsv/qsvh264enc.html, and https://gstreamer.freedesktop.org/documentation/mediafoundation/mfh264enc.html
