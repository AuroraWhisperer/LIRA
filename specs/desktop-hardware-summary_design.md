# Feature: 桌面硬件概览

## Requirements

While the performance panel is opened, when the client requests its initial
hardware summary, the system shall show the current CPU model, installed memory
capacity and module details, and physical GPU model and reported video-memory
capacity. This capacity represents dedicated or reserved memory, not the shared
system-memory limit. Saturated legacy values shall be shown as unknown when a
reliable capacity cannot be read. Virtual display adapters shall not be presented
as GPUs.

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
- Backend: `hardware-summary.js` owns the hardware inventory. It uses Node `os`
  data for CPU and total memory, starts one hidden PowerShell CIM query for
  static Windows device details and the corresponding driver's 64-bit memory
  capacity, and invokes `nvidia-smi` for NVIDIA GPU temperatures during an
  explicit refresh. `system-metrics.js` measures the CPU sampling window with a
  monotonic clock and records its end as wall time before waiting for GPU counters.
  Memory-source and fallback rules belong to the
  [system-metrics reference](../docs/reference/backend/server-core.md#8-系统指标).
- API: `GET /api/system/hardware` returns a narrow, read-only summary. The
  optional `includeTemperatures=true` flag is interpreted server-side; no value
  is inserted into a shell command.
- Security: the endpoint follows the existing local system-metrics route. It
  exposes no serial numbers, process data, credentials, or arbitrary command
  execution. Successful static queries are cached in memory for the server lifetime.

## Non-goals

- No background poller, Windows service, kernel driver, or new dependency.
- No claimed CPU, memory, or non-NVIDIA GPU temperature where the operating
  system does not provide a trustworthy value.
- No persistence of hardware identifiers or sensor readings.

## Acceptance Criteria

1. The performance panel displays CPU model and core/thread counts, installed
   memory capacity and module information, and each detected GPU name and VRAM.
2. Initial hardware loading starts no repeating timer. Concurrent requests share
   the static query. If it fails, the caller receives basic OS data and the next
   request retries. Display queries reuse their result for five seconds.
3. A five-second sample refreshes temperature values with a short-lived command
   only when an NVIDIA adapter is detected. A reading must match a unique model
   in both the inventory and the temperature output. Missing or ambiguous
   readings return `null` and appear as unavailable.
4. Existing `/api/system/metrics` response and performance cards keep their
   current behavior.
