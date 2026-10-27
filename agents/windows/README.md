# 3rdEye Windows Agent — Phase 1 (F1/F2/consent) + Phase 2 F3 enforcement

A visible tray agent enforcing screen-time/bedtime lockout (F1), local
DNS-based content filtering (F2), and app control (F3, STORY-11) from a
locally-cached `Policy` — no per-app screen-time limits yet.

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
- `InstalledAppInventory.cs` — STORY-11's F3 inventory: enumerates the
  registry Uninstall keys (both 64- and 32-bit hives), reports the full
  current list every poll (idempotent on the backend, so no local diff
  needed), and exposes `LastKnownAppIds` for `AppBlockEnforcer` to match
  against.
- `AppBlockEnforcer.cs` — F3 "block from running": terminates a blocked
  app's process when found running. Not AppLocker/WDAC-grade (that's
  Enterprise-edition-only) — a background process watcher is the smallest
  thing a Home/Pro install actually allows. Matches a running process to
  an installed app by a normalized-substring heuristic (a process's image
  name and its registry `DisplayName` aren't the same string) — a real
  limitation, not a guaranteed-correct mapping. Includes a respawn guard:
  debounces repeated kill attempts and gives up (with one alert, not a
  spam loop) after 3 consecutive respawns rather than fighting forever.

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
- `AppBlockEnforcer`'s process-name-matching heuristic will have both
  false negatives (a real match it doesn't catch, because the process
  image name doesn't resemble the registry DisplayName closely enough)
  and, in principle, false positives on a short/generic process name —
  guarded against short names (<3 normalized characters are never
  matched) but not eliminated. This is the documented limitation
  family-tier-spec.md §2.1 already names for Windows' app-control row;
  a production-grade mapping would need the install path correlated to
  the running executable, not implemented in this slice.
- No install-gate enforcement for non-Store apps on Windows (family-
  tier-spec.md §2.1's known gap) — `AppBlockEnforcer` only catches an
  unapproved app once it's already running, never prevents the install
  itself for anything outside the Microsoft Store's own approval setting.
