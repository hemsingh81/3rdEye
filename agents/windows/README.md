# 3rdEye Windows Agent — Phase 1 slice (F1 + F2 + consent)

Covers exactly mvp-build-plan.md Phase 1's scope: a visible tray agent that
shows the mandatory consent screen once, then enforces screen-time/bedtime
lockout (F1) and local DNS-based content filtering (F2) from a locally-cached
`Policy` — no per-app limits, no app-install control (F3, Phase 2).

**This was written on a Mac and has never been built or run.** There's no
Windows/.NET toolchain in this environment to compile or test it — per
testing-strategy-spec.md §3.4, that needs an actual Windows machine (or a
Windows VM via UTM/Parallels/cloud VM). Before relying on this code:

```powershell
dotnet build
dotnet run
```

on a real Windows box with the .NET 8 SDK, then exercise
testing-strategy-spec.md §6's offline-lockout scenarios (Network Link
Conditioner-equivalent on Windows is Clumsy, per that doc).

## What's here

- `Program.cs` — entry point: loads local config (running `EnrollmentForm`
  first if there isn't one yet), shows consent once, starts the tray icon
  (non-hideable, per X1) and the lockout/sync timers.
- `EnrollmentForm.cs` — STORY-02's enrollment screen: backend URL +
  enrollment code → `GET /api/devices/by-code/:code` → writes `LocalConfig`.
  Shown before `ConsentForm`, same order family-tier-spec.md §3.1-3.2 lays
  out.
- `LockoutEnforcer.cs` — compares elapsed usage + current time against the
  cached `Policy` and calls `LockWorkStation()` (a documented Win32 API,
  the same action as Win+L) when the limit or bedtime window is hit.
- `PolicyClient.cs` — fetches `Policy` from the Phase 0/1 backend
  (`GET/PUT /api/devices/:id/policy`), caches it to a local JSON file so
  enforcement works with zero connectivity (offline-sync-spec.md §1–§3).
- `ConsentForm.cs` — the mandatory, un-skippable consent screen
  (family-tier-spec.md §3.2).
- `EventQueue.cs` — STORY-01's local durable event queue (append-only JSON
  Lines), flushed to `POST /api/devices/:id/events` on the same 5-minute
  sync timer as the policy pull. `LockoutEnforcer` enqueues an alert +
  usage event the moment it locks the device — durable on disk immediately,
  independent of whether a flush ever succeeds.
- `LocalConfig.cs` / `DevStandaloneConfig.cs` — local device identity +
  backend URL; the dev-standalone-mode-spec.md config-file path is wrapped
  in `#if DEBUG` so it's compiled out of release builds entirely, per that
  spec's "one hard rule."
- `DnsFilter.cs` — STORY-06's F2 enforcement: a local UDP DNS proxy that
  refuses resolution (NXDOMAIN) for a domain matching the cached policy's
  blocked categories, forwarding everything else to a real upstream
  resolver untouched. implementation-plan.md §1.6 has the full reasoning
  for choosing this over a TLS-intercepting proxy or a WFP/SNI driver.
- `RegistryPolicy.cs` — the DoH-disabling mitigation that ships *with*
  `DnsFilter.cs`, not after it: pushes the `DnsOverHttpsMode` policy to
  Chrome/Edge so their own encrypted DNS doesn't silently bypass the filter.

## Known shortcuts in this slice (upgrade later, don't build around now)

- Usage is tracked as "agent process alive" time, not per-app foreground
  time — correct for F1, not yet enough for Phase 2's per-app limits.
- `EventQueue.cs` is a JSON Lines file, not SQLite — offline-sync-spec.md
  §3 describes a fuller embedded-DB design; this is the smallest complete
  thing for Phase 1's single-device, single-queue case (development-
  stories.md STORY-01). Upgrade to SQLite once multiple writers or a real
  query need shows up, not before.
- `DnsFilter.cs`'s category→domain list is a small embedded sample, not a
  real licensed categorization feed — proves the mechanism, not production
  coverage. Needs the adapter's DNS pointed at 127.0.0.1 and the filter
  running with sufficient privilege to bind port 53 — both are an
  install-time `netsh`/elevation step this class doesn't perform on the
  system itself. The DoH-disabling mitigation only covers Chrome/Edge;
  Firefox needs a separate `policies.json` mechanism, not implemented yet
  — a real, disclosed gap, named here rather than silently uncovered.
