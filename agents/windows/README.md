# 3rdEye Windows Agent — Phase 1 slice (F1 + F2 + consent only)

Covers exactly mvp-build-plan.md Phase 1's scope: a visible tray agent that
shows the mandatory consent screen once, then enforces screen-time/bedtime
lockout (F1) from a locally-cached `Policy` — no per-app limits, no content
filtering enforcement yet (F2 is specced but not wired to a real filter
driver in this slice), no app-install control (F3, Phase 2).

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

## Known shortcuts in this slice (upgrade later, don't build around now)

- Usage is tracked as "agent process alive" time, not per-app foreground
  time — correct for F1, not yet enough for Phase 2's per-app limits.
- `EventQueue.cs` is a JSON Lines file, not SQLite — offline-sync-spec.md
  §3 describes a fuller embedded-DB design; this is the smallest complete
  thing for Phase 1's single-device, single-queue case (development-
  stories.md STORY-01). Upgrade to SQLite once multiple writers or a real
  query need shows up, not before.
- F2 (content filtering) is in the cached `Policy` shape but nothing in
  this code enforces it yet — that needs a Network Extension-equivalent
  (a WFP callout driver or proxy), which is real platform work, not a
  shortcut to skip quietly.
