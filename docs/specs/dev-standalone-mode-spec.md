# 3rdEye — Dev-Only Standalone Mode (Draft v0.1)

**DEV/TEST TOOLING ONLY. This mechanism must never exist in a production installer or production binary.** Scope: lets a developer/tester install the agent on a machine (e.g. your Windows laptop) and have it enforce a policy entirely from a local config file, with **no backend connection at all** — not even the one-time online enrollment that [offline-sync-spec.md](./offline-sync-spec.md) otherwise requires. This is for exercising the local policy engine (lockout, filtering, etc.) in full isolation while building it, before the real backend/consent flow exists or is reachable. It is a different thing from offline-sync-spec.md's offline-first design (which assumes one real online enrollment, then offline-capable operation) — standalone mode skips enrollment entirely, for testing only.

## 1. The One Hard Rule

**A release/production build of the agent must not contain this code path at all** — not "disabled by default," not "gated behind a hidden flag," but compiled out of release builds entirely (a separate build target/configuration, e.g. `3rdeye-agent-dev` vs. `3rdeye-agent-release`, per platform). A config-file check that's merely *off by default* in a production binary is still a landmine: if that file ever ends up on a real customer's machine (accidentally, or placed by anyone other than a developer), it would let the agent run with zero consent and zero backend oversight — structurally identical to the covert-mode behavior this entire product is designed to never have (per product-spec.md §2). This isn't a "ship it disabled" situation; it's a "the code must not be in that binary" situation.

Enforcement mechanisms for this rule:
- A compile-time flag (`#if DEV_BUILD` / build-variant config per platform's native tooling) wraps the entire standalone-mode code path, not a runtime config check.
- CI (per testing-strategy-spec.md §8) verifies the release build artifact does **not** contain the standalone-mode code — e.g. a symbol-presence check or string-scan for the config-file-discovery logic, failing the build if found in a release-tagged artifact.
- Dev builds are visually distinct (e.g. a watermark/banner in the agent's own UI — "DEV BUILD — standalone mode available") so nobody confuses a dev build for a release one during testing.

## 2. Config File Format

A plain-text, human-editable file — easy to hand-edit per test machine, no build step needed to change test policy:

```
# 3rdeye-dev-config.txt — DEV BUILD ONLY, never bundle with a release installer
mode=standalone

# Identity (synthetic — no real backend entities exist for these)
device_id=dev-win-laptop-01
family_id=dev-family-01
child_profile_id=dev-child-01
policy_version=dev-1

# Consent — pre-accepted for standalone testing; the on-device disclosure
# screen (per family-tier-spec.md §3.2) still RENDERS using this data,
# it's just pre-filled instead of waiting for a tap, so UI/consent-copy
# testing still works without backend round-trips.
consent.accepted=true
consent.accepted_at=2026-10-27T00:00:00Z
consent.accepted_by=dev-tester

# Policy (mirrors Policy fields from system-architecture-spec.md §3)
policy.screen_time.daily_limit_minutes=120
policy.screen_time.bedtime_start=21:00
policy.screen_time.bedtime_end=07:00
policy.content_filter.categories=adult,violence,gambling
policy.content_filter.custom_block=example-blocked-site.test
policy.location.enabled=false
policy.app_install_approval.enabled=false

# Local storage
local_data_dir=%PROGRAMDATA%\3rdEye\dev\       # Windows; see §3 for per-platform paths
log_level=debug

# Networking — deliberately blank: standalone mode never attempts to
# reach a backend, by design, not because none is configured
backend_url=
sync_enabled=false
```

A sample file (ready to drop next to a dev installer) is at [dev-tools/dev-standalone-config.sample.txt](../../dev-tools/dev-standalone-config.sample.txt).

## 3. Discovery & Startup Behavior (dev builds only)

On startup, a **dev build** checks, in order:
1. A file named `3rdeye-dev-config.txt` in the same folder as the installer/executable (the simplest case — drop the file next to the installer before running it on the test machine).
2. If not found there, a well-known per-OS location:
   - Windows: `%ProgramData%\3rdEye\dev-config.txt`
   - macOS: `/Library/Application Support/3rdEye/dev-config.txt`
   - Android (debug builds): a config asset pushed via `adb push` to a known app-private path, or bundled in the debug APK's assets for emulator testing
   - iOS (debug builds): bundled in the debug build's app bundle for Simulator testing (physical-device standalone testing is lower priority — most standalone-mode testing happens on Windows/macOS/Android where it's easiest to iterate)
3. **If found**: parse it, seed the local embedded DB (per offline-sync-spec.md §3 — same local DB the real offline-first design uses) directly with the synthetic `Policy`, `ConsentRecord`, and device identity from the file. Enter `standalone` mode: enforce the policy exactly as it would online, write all events (`UsageEvent`, `AlertEvent`, etc.) to the local queue as normal, but **never attempt a backend sync** — `sync_enabled=false` is enforced in code, not just honored from the file (so a tester can't accidentally half-configure this into a confusing hybrid state).
4. **If not found**: normal flow — real online enrollment required first, per offline-sync-spec.md, exactly as a release build behaves (a dev build with no config file present behaves identically to release for this purpose, which is what makes it a safe default).
5. **Writing "into a defined folder based on setting"**: `local_data_dir` from the config file is where the agent's local DB, event queue, and any captured artifacts (e.g. screenshots if that feature is being tested) actually get written — so a tester can go look at exactly what the agent is storing, which is also useful for verifying the "transparent, nothing hidden" design even in this dev-only mode.

## 4. How This Supports Your Windows-Laptop Testing Setup

Two independent testing modes, both valid, serving different purposes:

| Mode | What it tests | Needs the Mac backend? |
|---|---|---|
| **LAN-connected mode** (per the earlier testing-strategy-spec.md discussion) | The real end-to-end flow — enrollment, consent, sync, billing events reaching the Podman backend | Yes — Windows laptop points at the Mac's LAN IP |
| **Standalone mode** (this doc) | The local policy engine in isolation — lockout logic, content filtering, local storage — with zero network dependency | No — fully offline, no Mac/backend needed at all, works even if the laptop is nowhere near the Mac |

Recommend using **standalone mode first** while the local enforcement logic is actively being built (fastest iteration loop, no backend required), then **LAN-connected mode** once you're ready to test the real consent/sync/billing path end-to-end — both are useful, at different points in development, and neither replaces the other.

## 5. Open Questions
- Should standalone mode support *changing* the config file while the agent is running (hot-reload) for faster iteration, or require a restart each time (simpler, less state-management risk)? Recommend restart-only for now — simpler and this is throwaway dev tooling.
- Does Android/iOS standalone-mode testing (via adb push / debug bundle) need its own slightly different doc, or is this shared doc sufficient once someone actually builds that path? Revisit once Phase 1 (Android + Windows per mvp-build-plan.md) is underway and the Windows/Android instances of this diverge if they do.
