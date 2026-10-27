# 3rdEye — Android Agent (Draft v0.1)

Scope: the Android counterpart to `agents/windows/` — same Phase 1 feature set (F1 lockout, consent screen; F2 is DNS-based per implementation-plan.md §1.6, platform-shared), different native mechanism because Android's actual options for a *non-MDM-enrolled* consumer device are different from Windows'. This is a design spec, not code — mirrors the Windows agent's file-by-file structure so the two stay comparable.

## 1. The Provisioning-Model Decision (why this isn't just "DevicePolicyManager")

family-tier-spec.md §2.1 describes Android's native mechanism as "Family Link Device Policy Controller," but Family Link is Google's own first-party product — a third-party app cannot provision a device as a Family Link–style Device Owner through a normal app install; that requires a factory-reset-time enrollment flow (QR/NFC provisioning), which is exactly the Fleet-tier onboarding experience (fleet-tier-spec.md §3.2), not a normal home setup where a parent installs an app on an already-set-up phone.

**Decision: Accessibility Service + `UsageStatsManager` + a full-screen overlay**, not Device Owner mode, for Family tier. This is the same category of mechanism family-tier-spec.md §5 already names as acceptable ("Accessibility Service only if genuinely needed... with explicit in-flow disclosure of why it's requested") and what comparable third-party apps (not Google's own Family Link) actually ship. Fleet tier's Android Enterprise / zero-touch provisioning (fleet-tier-spec.md §2 item 1) is unrelated and unaffected by this — that's a different enrollment model for company-owned devices, already correctly specced there.

- `UsageStatsManager` (a public, disclosed-permission API) gives foreground-app time — the equivalent of the Windows agent's "agent alive" shortcut, but actually accurate per-app here, which is a genuine improvement, not a shortcut, worth noting for when Windows' F1 enforcement is revisited.
- An Accessibility Service detects the foreground app and, when the cached `Policy`'s daily limit or bedtime window is hit, draws a full-screen overlay that can't be dismissed except by the parent's own unlock mechanism — Android's equivalent of `LockWorkStation()`.
- This stays within the "no private APIs, no root, no jailbreak-equivalent" rule product-spec.md §2 sets — Accessibility Service is a standard, disclosed, revocable permission.

## 2. File-by-File Mapping to the Windows Agent

| Windows (`agents/windows/`) | Android equivalent | Notes |
|---|---|---|
| `Program.cs` | `MainActivity.kt` / `ThirdEyeAccessibilityService.kt` | Android splits "UI entry point" and "always-running background enforcement" into two components by platform convention — the Windows agent's single `Program.cs` doing both is a Windows-shaped choice, not a cross-platform pattern to force onto Android. |
| `LocalConfig.cs` | `LocalConfig.kt` (backed by `EncryptedSharedPreferences`, not a plain JSON file) | Android has a standard encrypted-storage primitive for exactly this; use it rather than reinventing the Windows agent's plain-JSON approach — this is a case where the *platform's* idiom is the smallest-complete-thing, not a literal port. |
| `PolicyClient.cs` | `PolicyClient.kt` (OkHttp + Retrofit, or just OkHttp — don't add Retrofit for three endpoints) | Same contract as Windows: fetch, cache, fall back to cache on failure. Local cache file: Room is overkill for one cached object — a single encrypted-prefs entry (see above) is the actual smallest-complete-thing here, the same call the Windows agent made with a plain JSON file over SQLite. |
| `LockoutEnforcer.cs` | `LockoutEnforcer.kt`, driven by the Accessibility Service's foreground-app callback instead of a timer tick | Same daily-reset and per-trigger-guard logic the Windows review pass fixed (§1 of this doc's "known shortcuts" below calls this out explicitly so it isn't re-introduced here). |
| `ConsentForm.cs` | `ConsentActivity.kt` | **Same copy, not reworded** — family-tier-spec.md §3.2's disclosure text is platform-neutral; translating it into different wording per platform would itself be a trust problem (the marketing site's Trust page promises one consistent list, not a per-platform remix). |
| Tray `NotifyIcon` (X1) | A persistent, non-dismissable foreground-service notification | Android's actual equivalent of "can't be hidden" — a foreground service is required to even run background enforcement reliably on modern Android, which conveniently forces the always-visible notification as a side effect of the correct architecture, not an extra feature. |
| `DevStandaloneConfig.cs` (`#if DEBUG`) | A `buildType`-gated source set (`debug/`), never compiled into the `release` build variant | Same hard rule as dev-standalone-mode-spec.md §1 — Android's build-variant system is the direct equivalent of the C# `#if DEBUG` compile-out guarantee, not a weaker substitute for it. |

## 3. Known Shortcuts in This Design (carried over deliberately, not forgotten)

- **Reuse the Windows agent's daily-reset bug fix, don't reintroduce it.** The Windows `LockoutEnforcer` originally never reset its usage counter at midnight and re-fired its lock every tick once triggered — both fixed in commit `d040b88`. The Android `LockoutEnforcer.kt` needs the same date-rollover reset and per-trigger guard from day one of implementation, not as a bug found later.
- No event queue design repeated here — it's the same `UsageEvent`/`AlertEvent` local-cache-then-sync shape implementation-plan.md §1.1 specs once, shared by both platforms' agents; this doc doesn't redefine it.
- F2 (content filtering) is **platform-shared, not redesigned per OS** — implementation-plan.md §1.6's DNS-based decision and its DoH-disabling mitigation apply here exactly as specced for Windows; Android's equivalent of the registry-policy mitigation is a `PRIVATE_DNS` / DoH-mode device policy, same mechanism family, same gap, same disclosure obligation.

## 4. Open Questions

- `UsageStatsManager` requires the user to grant it via a system settings screen the app can't auto-navigate past (a Google anti-abuse measure) — the consent flow (§2) needs an explicit "now go grant this permission" step with its own disclosure copy, not an assumption it's silently available after the main consent screen.
- Some OEM Android skins (e.g. aggressive battery-optimization on certain Samsung/Xiaomi builds) kill background services more aggressively than stock Android — testing-strategy-spec.md's Android Emulator testing won't catch this; needs a real physical-device pass per OEM before Phase 1 exit, not just emulator coverage.
