# Feature: 桌面硬件概览

## Requirements

While the performance panel is opened, when the client requests its initial
hardware summary, the system shall show the current CPU model, installed memory
capacity and module details, and physical GPU model and reported video-memory
capacity. Virtual display adapters shall not be presented as GPUs.

While the user starts a five-second performance sample, when the sample runs,
the system shall refresh any supported hardware temperatures without creating a
resident monitoring process.

While Windows, a driver, or a sensor does not expose a temperature, when the
summary is rendered, the system shall identify that value as unavailable rather
than reporting a guessed temperature. An unavailable CPU temperature shall be
shown as `未知`, and the memory card shall not show a temperature row.

## Architecture

- Frontend: `metrics.js` requests static hardware details once at initialization
  and refreshes temperatures only alongside the existing explicit sample. The
  renderer writes all returned values through `textContent`.
- Backend: `system-metrics.js` owns operating-system reads. It uses Node `os`
  data for CPU and total memory, starts one hidden PowerShell CIM query for
  static Windows device details, and conditionally invokes `nvidia-smi` for an
  NVIDIA GPU temperature only during a refresh.
- API: `GET /api/system/hardware` returns a narrow, read-only summary. The
  optional `includeTemperatures=true` flag is interpreted server-side; no value
  is inserted into a shell command.
- Security: the endpoint follows the existing local system-metrics route. It
  exposes no serial numbers, process data, credentials, or arbitrary command
  execution; static results are cached in memory for the server lifetime.

## Non-goals

- No background poller, Windows service, kernel driver, or new dependency.
- No claimed CPU, memory, or non-NVIDIA GPU temperature where the operating
  system does not provide a trustworthy value.
- No persistence of hardware identifiers or sensor readings.

## Acceptance Criteria

1. The performance panel displays CPU model and core/thread counts, installed
   memory capacity and module information, and each detected GPU name and VRAM.
2. Initial hardware loading starts no repeating timer; repeated page visits use
   the in-process static-summary cache.
3. A five-second sample refreshes temperature values with a short-lived command
   only when an NVIDIA adapter is detected; unsupported values have clear UI
   text.
4. Existing `/api/system/metrics` response and performance cards keep their
   current behavior.
