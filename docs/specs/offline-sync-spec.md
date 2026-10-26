# 3rdEye — Offline-First Operation & Sync Spec (Draft v0.1)

New cross-cutting requirement: **every agent must keep working with no internet connection**, enforcing policy and capturing data locally, and sync to the backend automatically once connectivity returns — the Admin Console only ever reflects synced data, never a live/required connection to the device. This doc analyzes what's actually achievable offline per feature (some things are physically impossible offline, and we say so rather than overclaim), and the architecture needed to support it.

Ties into: [system-architecture-spec.md](./system-architecture-spec.md) (adds a local-agent data layer), [feature-list.md](./feature-list.md) (adds an offline-capability column), all three tier specs, and [mvp-build-plan.md](./mvp-build-plan.md) (this becomes a Phase 0/1 foundation item, not a later add-on).

## 1. Core Principle: Local-First Enforcement, Eventually-Consistent Reporting

- **Policy enforcement is local.** The agent caches its current `Policy` (screen time rules, content filter lists, geofence definitions, work-hours schedule, compliance requirements) on-device. Enforcement decisions (lock the device, block a site, flag a file event) are made **entirely on-device**, using the local policy cache and the device's own clock/sensors — no round-trip to the backend required at the moment of enforcement.
- **Data capture is local-first, queued, then synced.** Every event (`UsageEvent`, `LocationEvent`, `AlertEvent`, `ScreenshotEvent`, `DlpAlertEvent`, `ComplianceCheckEvent`) is written to a local, durable, encrypted-at-rest queue on the device the instant it happens, with its real timestamp. The queue flushes to the Event Ingestion Service as soon as connectivity is available — order-preserving per device, but the backend must accept and correctly timestamp **late-arriving** events (see §4).
- **The Admin Console is a view of synced state, not a live connection to the device.** Parents/admins/IT never block on a device being online to see history — they see "last synced: X minutes/hours ago" and act on the most recent data available.

## 2. Per-Feature Offline Capability Analysis

This is the honest breakdown — some features are inherently one-directional (server → device) and cannot function with no connectivity at all, because the whole point is a remote party acting on the device. We call these out explicitly rather than implying full offline parity everywhere.

### Fully offline-capable (enforcement + capture both work with zero connectivity)

| Feature | How it works offline |
|---|---|
| F1 Screen time limits + lockout | Local policy cache + device clock; lockout triggers with no server round-trip |
| F2 Content filtering | Category/custom lists cached locally; filtering decision made on-device (DNS/Network Extension) |
| E1/E2 Usage & idle tracking | Captured locally, queued |
| E8 Work-hours gating | Local clock-based, same as F1 |
| E5 DLP alert detection (the detection + optional local block) | File-system watcher runs locally; alert queued; if policy says "block the copy," that block is a local action too |
| M5 Compliance checks | Run locally against cached policy (OS version, encryption status, passcode) |
| M6 Asset inventory collection | Collected locally, queued |
| F4/M7 Location capture + on-device geofence evaluation | GPS/location captured locally; geofence boundaries cached on-device so entry/exit **detection** happens offline — only the **alert delivery to the parent/admin** is deferred until sync (see below) |
| F5 Communication metadata capture | Captured locally, queued |

### Partially offline-capable (capture/detection works offline, but the human-facing action is deferred)

| Feature | Offline behavior | What's deferred until sync |
|---|---|---|
| F4/M7 Geofence **alerts** | Entry/exit is detected and timestamped on-device | The parent/admin's push notification only fires once the device reconnects and the event syncs — a geofence crossing while offline is reported late, not missed, but not real-time either |
| F3 App install approval | Device can either (a) block all new installs by default while offline until approval syncs, or (b) allow with a queued "pending approval" flag — **this default must be an explicit policy setting**, not an implicit choice | The approval decision itself requires the parent to see the request, which requires connectivity on the parent's side |
| E4 Screenshots | Captures and stores locally (encrypted, with a local retention cap to bound storage use) | Upload to the Employer dashboard deferred until sync; employee-visible local timestamp log still works offline (transparency doesn't depend on the network) |

### Inherently requires connectivity (cannot be made to work offline — physics, not an engineering gap)

| Feature | Why it can't work offline |
|---|---|
| M2 Remote lock | This is a **server-initiated command** — by definition, the device must be reachable to receive it. A device that's offline simply can't be remotely locked until it reconnects. |
| M3 Remote wipe | Same reasoning as M2. |
| M4 Lost-mode trigger | The *trigger* (admin flags a device lost) requires the device to receive that command — it activates on next connectivity, not instantly. However, once lost-mode is active, the lock screen itself persists locally even through a reboot, independent of connectivity. |
| M8 Bulk policy push | Can't push to an unreachable device — queued server-side, delivered next connectivity window (standard MDM protocol behavior, already true for every MDM vendor) |
| E3/E7/M9 Reports, rollups, manager/viewer dashboards | These are server-side aggregations over synced data by definition — nothing to show until data syncs |

**This asymmetry is expected and should be stated plainly in product marketing/help content, not hidden**: offline-first means "the device keeps enforcing policy and keeps collecting data with no internet," not "an admin can control a device with no internet" — those are different claims and only the first one is true for any product, including every competitor (MDM commands always require connectivity, in Jamf/Intune/etc. too).

## 3. Local Data Layer (Agent-Side Architecture Addition)

Each agent needs a local, embedded store — not just an in-memory buffer — since an offline period could span hours or days:

- **Local embedded DB** (e.g. SQLite on all 4 platforms — mature, available natively on Android/iOS/macOS/Windows) holding:
  - Current `Policy` snapshot (+ version, for conflict detection on next sync)
  - Current `ConsentRecord` / feature-flags snapshot (so the consent-flag validation described in system-architecture-spec.md §4 can still happen meaningfully offline — the agent itself should refuse to capture data for a feature not in its cached consented flags, as a second enforcement point, not just the server-side one)
  - Outgoing event queue (`UsageEvent`, `LocationEvent`, etc.) — append-only, durable across app restarts/device reboots
  - Pending incoming commands are N/A offline by definition (§2) — nothing to cache here, they simply arrive on next connect
- **Local storage caps**: screenshots (E4) and any locally-cached media need a retention/size cap with oldest-first eviction, to avoid unbounded disk usage during a long offline period — surfaced to the admin/parent as a configurable policy field, not a hardcoded magic number.
- **Encryption at rest** for this local store (consistent with the "no plaintext sensitive data sitting on disk" expectation already implicit in the compliance sections of the other specs).

## 4. Sync Protocol

1. On connectivity (detected via standard OS network-reachability APIs, not a custom polling loop — ties into av-edr-compliance-spec.md §5's "don't look like a beaconing process" guidance), the agent:
   - First checks for a `Policy` update (pull) — if the cached policy version is stale, downloads the new one and re-validates its own consent-flag cache before resuming data capture under any newly-enabled feature (a feature flip, same as the online case, requires fresh `ConsentRecord` display before it takes effect — see licensing-billing-spec.md §7).
   - Then flushes the queued events (push), in timestamp order, batched to avoid a thundering-herd upload spike after a long offline period.
2. **Backend must treat event timestamps as the source of truth, not arrival time.** `UsageEvent`/`LocationEvent`/etc. already carry the real on-device timestamp (per §1); the Metering & Billing Service and Analytics Store must aggregate by event timestamp, not ingestion timestamp, so a billing period doesn't under- or over-count usage that happened right at a period boundary but synced late.
3. **Idempotent ingestion**: each queued event carries a client-generated unique ID so a retried/duplicate upload (e.g. connectivity drops mid-flush) doesn't double-count in metering or duplicate an alert.
4. **Partial sync handling**: if connectivity drops mid-flush, the queue resumes from the last unacknowledged event on next connect — no data loss, no need to re-flush already-acknowledged events.
5. **Conflict case — policy changed on server while device was offline AND device needs to re-consent**: if the parent/admin changed `Policy` in a way that flips a feature flag while the device was offline, the device must show the re-consent screen **before** applying the new policy, even though it's now "behind" — never silently apply a newly-disclosed feature without the on-device consent step just because the change happened while offline.

## 5. Admin Console UX Implications

- Every device row in the dashboard shows **last synced** timestamp, not just "online/offline" — admins/parents need to know how stale the data is, not just binary connectivity.
- Remote actions (M2/M3/M4/M8) show a **pending** state when issued to an offline device, with clear "will apply once the device reconnects" messaging — never implying the action already happened.
- Billing/metering views should show a **provisional vs. finalized** distinction for the current period if there's known queued-but-unsynced usage expected (e.g. "estimate may increase once offline devices sync") — avoids a confusing invoice that changes after the fact with no explanation.

## 6. Data Model Additions

- `Device.last_synced_at` (replaces/augments `last_seen` — distinguishes "we got a heartbeat" from "we actually received queued data")
- `SyncBatch` (id, device_id, synced_at, event_count, earliest_event_ts, latest_event_ts) — audit trail for sync operations, useful for debugging billing disputes ("why did my invoice change after the fact")
- `Policy.version` (already implied, made explicit) — needed for the staleness check in §4 step 1
- Event tables (`UsageEvent` et al.) gain a `client_event_id` (idempotency key) and keep their existing `ts` field as the authoritative timestamp, with a separate `ingested_at` for debugging/audit only

## 7. Impact on MVP Build Plan

This is foundational, not a later add-on — local-first enforcement is *already* assumed by family-tier-spec.md's lockout requirement and system-architecture-spec.md §4's "local-first" example, but the actual local DB + queue + sync protocol wasn't previously specced as deliverable work. Recommend folding this into **Phase 0** (foundations) and **Phase 1** (MVP slice) of mvp-build-plan.md, rather than treating it as a Phase 2+ enhancement — the Phase 1 exit criterion ("lockout actually works") already implicitly requires most of §1–§3 of this doc to be true.

## 8. Open Questions
- Maximum offline duration we design for (a device offline for an hour is very different from offline for 3 weeks — affects local storage cap sizing, especially for E4 screenshots)?
- For F3 (app install approval) default-while-offline behavior — block-by-default or allow-with-pending-flag? Recommend block-by-default for under-13 age band, admin-configurable for older age bands/employer tier.
- Should the employee/child-facing "what's tracked about me" screen (F6/E6) show locally-queued-but-unsynced data, or only confirmed-synced data? Recommend showing local data immediately (it's the most transparent option and reinforces the no-covert-mode trust model) with a "pending sync" indicator.
