# 3rdEye Android Agent — Phase 1 (F1/consent) + Phase 2 F3 (STORY-12)

Covers the same Phase 1 scope as `agents/windows/`, mapped onto Android's
actual mechanisms per [android-agent-spec.md](../../docs/specs/android-agent-spec.md):
Accessibility Service + `UsageStatsManager` + a full-screen lock, not
Device Owner/MDM provisioning (that's Fleet tier, a different enrollment
model entirely).

**This has never been built, run, or even syntax-checked.** This
environment has no Android SDK or Gradle at all — not even enough to
compile-check it the way `agents/windows/` got checked with `dotnet build`.
Before relying on any of this code:

```bash
./gradlew assembleDebug
```

on a machine with the Android SDK installed, then exercise it in the
Android Emulator per testing-strategy-spec.md §3.2 — and expect compile
errors on the first attempt; this was written against the Android API
surface from memory/documentation, not validated against an actual
compiler or IDE.

## What's here (mirrors android-agent-spec.md §2's file-by-file mapping)

- `MainActivity.kt` — enrollment (same flow as Windows'
  `EnrollmentForm.cs`) + the explicit Usage-Access/Accessibility
  permission walk android-agent-spec.md §4 calls for.
- `ConsentActivity.kt` — same disclosure copy as `ConsentForm.cs`, word
  for word, not reworded per platform.
- `ThirdEyeAccessibilityService.kt` — the always-running piece: detects
  the foreground app, drives `LockoutEnforcer`, runs the 5-minute
  policy-pull/event-flush sync loop, and posts the persistent "3rdEye —
  active" notification (X1's Android equivalent, forced by the platform's
  own background-execution rules).
- `LockedActivity.kt` — the lock screen itself, Android's `LockWorkStation()`.
- `LockoutEnforcer.kt` — carries over **both** review fixes already found
  in the Windows agent (the daily-reset bug and the per-trigger-guard
  spam fix, commit `d040b88`) from day one, per android-agent-spec.md §3's
  explicit instruction not to rediscover them here.
- `PolicyClient.kt` / `EventQueue.kt` — same fetch/cache/fallback and
  durable-queue-then-sync contracts as the Windows agent, including the
  atomic-rename-before-flush fix and the concurrency lock (STORY-06's
  review catch on Windows applies here too — the accessibility service's
  callback thread isn't the same thread the sync loop runs on).
- `LocalConfig.kt` — `EncryptedSharedPreferences`, not a JSON file; the
  platform's own idiom for this, not a literal port.
- `InstalledAppInventory.kt` — STORY-12's F3 inventory: `PackageManager`
  (disclosed, standard API, no extra permission walk) gives an exact
  package-name `app_id` — unlike the Windows agent, there's no registry-
  DisplayName-vs-process-name heuristic here at all, a genuine platform
  advantage. Reports the full current list every poll (same "no local
  diff needed, backend upserts idempotently" call as Windows).
- `ThirdEyeAccessibilityService.kt`'s `onAccessibilityEvent` now also
  checks the foreground package against the cached policy's
  `app_allowlist` before handing off to `LockoutEnforcer` — a blocked app
  shows the same `LockedActivity` overlay the lockout uses, with a
  different message. Scoped to packages `InstalledAppInventory` actually
  reported (never a system/launcher package nobody was asked to approve),
  excludes the agent's own package explicitly (it would otherwise
  default-deny itself the moment it comes to the foreground), and
  debounces repeated overlay launches for the same package — the same
  respawn-guard reasoning as the Windows `AppBlockEnforcer`'s kill
  debounce, applied to relaunching an Activity instead of killing a
  process.

## Known shortcuts and gaps (named, not silently skipped)

- **`DevStandaloneConfig.kt` (in `src/debug/`) is not wired into
  `MainActivity.kt`.** Referencing a debug-only class from `src/main`
  would break the `release` variant's compilation entirely — this needs a
  proper seam (a debug-only `MainActivity` override, or a small DI hook),
  which is follow-up work, not something faked here to look complete.
- The lock screen (`LockedActivity`) is a full-screen Activity launched on
  top, not a true `SYSTEM_ALERT_WINDOW` overlay — simpler, needs no extra
  permission, but a determined user switching away via the recents screen
  before it draws is a real, unverified gap. Upgrade only if that turns
  out to matter in practice — same "measure before upgrading" discipline
  implementation-plan.md §1.6 already applies to the DNS filter's own gap.
- F2 (content filtering) is **not implemented in this agent at all yet** —
  android-agent-spec.md §3 says it's platform-shared with Windows'
  DNS-based decision (implementation-plan.md §1.6), including a
  `PRIVATE_DNS`/DoH-mode device policy as Android's version of the
  Chrome/Edge registry mitigation, but porting `DnsFilter.cs` to Android's
  networking APIs (`VpnService` or a local proxy — Android doesn't expose
  a simple binds-to-port-53 equivalent the way desktop OSes do) is real,
  separate platform work, not done in this pass.
- `ConsentActivity.kt`'s failure-path UI (show an error on a failed
  consent POST) is a `// TODO`-equivalent comment, not implemented — the
  Windows `ConsentForm.cs` shows a `MessageBox`; the Android version needs
  its own UI wiring for the same case.
- No automated test exists for any of this — there's no way to run one
  without the SDK this environment lacks. The acceptance criteria from
  development-stories.md STORY-07 and STORY-12 are both **unverified**.
- STORY-12's install-gate half (preventing the install in the first
  place) is **not built** — only block-from-running. Android's own
  install-gate is the Play Store's own approval setting (family-tier-
  spec.md §2.1's Android row), which this agent doesn't touch; a
  sideloaded APK installs outside any gate here, same category of
  documented gap as every other platform.
