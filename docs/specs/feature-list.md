# 3rdEye — Consolidated Feature List (Draft v0.1)

Single source listing every feature across all three pillars, pulled from [family-tier-spec.md](./family-tier-spec.md), [employer-tier-spec.md](./employer-tier-spec.md), [fleet-tier-spec.md](./fleet-tier-spec.md), [licensing-billing-spec.md](./licensing-billing-spec.md), and [offline-sync-spec.md](./offline-sync-spec.md). Each feature is independently toggleable at checkout (per the unified purchase journey), independently metered for usage-based billing, and tagged for offline capability (Full = enforcement+capture both work with zero connectivity; Partial = detection/capture works offline but the human-facing alert/action is deferred until sync; None = inherently server-initiated, cannot function without connectivity — see offline-sync-spec.md §2 for why).

## 1. Family (Parental Controls)

| # | Feature | Platforms | Meter unit | Visible to child | Offline |
|---|---|---|---|---|---|
| F1 | Screen time limits & schedules (daily limit, bedtime, per-app) — **enforced login/session lockout at limit**, not just reporting | Android, iOS, macOS, Windows | per device-day | Yes — native OS lock screen (Family Link/Screen Time/Family Safety) + dashboard | **Full** — local policy cache + device clock, no server round-trip to lock |
| F2 | Content/web filtering (category blocklist + custom allow/block list) | Android, iOS, macOS, Windows | per 1,000 requests filtered | Yes — block notice shown at block time | **Full** — lists cached locally, filtering decision on-device |
| F3 | App control: default-deny install gate + **block unapproved apps from running** + **remote uninstall** | Install gate &amp; block: all 4 platforms (Store apps everywhere; non-Store desktop apps are a documented gap on macOS/Windows — see family-tier-spec §2.1). Remote uninstall: Android full support; iOS/macOS/Windows only on a supervised/MDM-enrolled device | install gate: per device-day; uninstall: per action | Yes — approval prompt, block notice, uninstall confirmation | **Install gate &amp; block: Full** — cached allowlist enforced locally, zero round-trip. **Remote uninstall: None** — server-initiated command, same as M2/M3 |
| F4 | Location sharing + geofence alerts | Android, iOS, macOS, Windows (desktop accuracy varies by hardware GPS/Wi-Fi) | per location ping | Yes — OS location indicator + in-app notice | **Partial** — geofence entry/exit detected on-device offline; parent alert delivery deferred until sync |
| F5 | Communication metadata (contact added, call/SMS counts — no content) | Android, iOS only (no telephony stack on desktop OS) | per device-day | Yes — listed in "what my parent can see" | **Full** — captured locally, queued |
| F6 | Child "what my parent can see" dashboard | Android, iOS, macOS, Windows | included (no separate meter) | n/a — this IS the disclosure feature | **Full** (local view) — shows locally-queued data immediately with a "pending sync" indicator |
| F7 | Multi-child / multi-device family management | Android, iOS, macOS, Windows | per active-seat-day (parent) | n/a | n/a — parent-side console feature, needs connectivity to view, not device-side |

## 2. Employer (Workforce Monitoring)

| # | Feature | Platforms | Meter unit | Visible to employee | Offline |
|---|---|---|---|---|---|
| E1 | App & website usage time (categorized) | Android, iOS, macOS, Windows | per device-day | Yes — personal usage summary | **Full** — captured locally, queued |
| E2 | Active/idle time & per-app focus duration | Android, iOS, macOS, Windows | per device-day | Yes | **Full** — captured locally, queued |
| E3 | Productivity summary reports (daily/weekly, team rollups) | Android, iOS, macOS, Windows | included (derived from E1/E2 events) | Partial — own data only, not team rollup | n/a — server-side aggregation over synced data |
| E4 | Periodic screenshots (opt-in, off by default) | macOS, Windows; Android/iOS only on supervised (MDM-enrolled) devices via OS screenshot API — not available on unsupervised BYOD per platform policy | per capture | Yes — capture indicator + timestamp log | **Partial** — captured + stored locally (encrypted, capped retention); upload deferred until sync |
| E5 | DLP-lite alerts (sensitive file type moved to USB/cloud, metadata only) | macOS, Windows | per 1,000 file-events scanned | Yes — alert log entry | **Full** — detection + optional local block both on-device; alert delivery queued |
| E6 | Employee "what's tracked about me" dashboard | all | included | n/a — this IS the disclosure feature | **Full** (local view) — same pending-sync pattern as F6 |
| E7 | Manager/Viewer scoped reporting (RBAC-limited) | all | per active-seat-day (manager) | n/a | n/a — server-side, needs connectivity |
| E8 | Work-hours schedule gating (agent idles outside work hours) | all | included | Yes — agent shows paused state | **Full** — local clock-based |

## 3. Fleet (MDM / Anti-Theft)

| # | Feature | Platforms | Meter unit | Visible to device user | Offline |
|---|---|---|---|---|---|
| M1 | Zero-touch device enrollment (DEP / Android Enterprise / Autopilot) | Android, iOS, macOS, Windows | per active-device-day | Yes — device use agreement at enrollment | n/a — first enrollment inherently needs connectivity; policy caches locally afterward |
| M2 | Remote lock | all | per action | Yes — lock screen itself | **None** — server-initiated command, applies on next connect |
| M3 | Remote wipe | all | per action | Yes — wipe confirmation / result | **None** — same as M2 |
| M4 | Lost-mode with custom recovery-contact lock screen | all | per day active | Yes — lock screen message | **None** to trigger (server push); once active, the lock screen itself **persists locally** through reboots independent of connectivity |
| M5 | Compliance checks (OS version, encryption, passcode, jailbreak/root detection) | all | per device-day | Yes — in-app remediation prompt if non-compliant | **Full** — runs locally against cached policy |
| M6 | Asset inventory (apps, OS version, storage, battery health) | all | per device-day (bundled with M5) | Partial — "what IT can see" screen | **Full** — collected locally, queued |
| M7 | Location tracking for company-owned devices | Android, iOS, macOS, Windows (desktop accuracy varies by hardware GPS/Wi-Fi, same caveat as F4) | per location ping | Yes — OS location indicator + device use agreement | **Partial** — same pattern as F4 |
| M8 | Bulk policy push / OS update enforcement | all | per action | Yes — update/policy prompt | **None** — server-initiated, delivered next connectivity window |
| M9 | IT Viewer read-only fleet inventory | all | per active-seat-day (viewer) | n/a | n/a — server-side, needs connectivity |

## 4. Cross-Cutting / Platform Infrastructure (not independently billable, but shared)

| # | Feature | Scope |
|---|---|---|
| X1 | Mandatory visible agent indicator (notification/tray/menu-bar icon, non-hideable) | All pillars, all platforms |
| X2 | Mandatory consent/disclosure screen at enrollment + on feature-flag change | All pillars |
| X3 | Tamper-evident "agent disabled" alert to admin/parent (not covert) | All pillars |
| X4 | Data export / delete controls (GDPR/CCPA-style rights for monitored person) | All pillars |
| X5 | Jurisdiction-aware consent gating (mandatory-notice regions) | Family (location/screenshots-equivalent), Employer (screenshots/location), Fleet (location) |
| X6 | Audit log of admin/manager/IT actions (policy changes, exports, remote actions) | Employer, Fleet |
| X7 | Usage-based billing engine: meters, allowances, caps, invoicing | All pillars (see licensing-billing-spec.md) |
| X8 | License template system (predefined + custom, feature-flag driven) | All pillars |
| X9 | Stale-device alert: flags + notifies when a device hasn't synced past a configurable threshold (default 24h) | All pillars — see offline-sync-spec.md §5 |

## 5. Explicitly Excluded (by design, all pillars)

- Hidden/stealth operating mode of any kind
- Keystroke content logging (keylogger)
- Covert or scheduled webcam/mic activation
- Message/call **content** interception (metadata only, where offered at all)
- Full browsing history at URL level (domain + category only)
- Any feature not reflected in the monitored user's own disclosure screen

## 6. Feature Count Summary

- Family: 7 features (F1–F7)
- Employer: 8 features (E1–E8)
- Fleet: 9 features (M1–M9)
- Cross-cutting infrastructure: 9 items (X1–X9, mostly non-billable/shared)
- **Total billable/toggleable features: 24**

## 7. Cross-Platform Coverage Summary

**Design goal: a feature supports all four platforms (Android, iOS, macOS, Windows) by default.** A feature is scoped to fewer platforms only when the underlying capability is physically absent on that OS, or when extending it would require a non-native/covert mechanism we've already ruled out.

- **22 of 24 features (92%) support all four platforms**, each via that OS's own sanctioned native API (Family Link/Screen Time/Family Safety for Family lockout+filtering; MDM protocols for Fleet; standard OS accessibility/window/location APIs for Employer).
- **2 features are intentionally narrower, for physical/policy reasons, not engineering convenience:**
  - **F5 (communication metadata)** — mobile-only; desktop OSes have no telephony stack to meter.
  - **E4 (screenshots)** — full support on macOS/Windows; on Android/iOS limited to supervised (MDM-enrolled) devices, since unsupervised mobile OS screenshot APIs aren't exposed to third-party apps by platform policy.
- **Two features carry a documented (not hidden) gap on desktop**: F3's install gate and block-from-running can be bypassed by a traditional (non-Store) desktop app on an unsupervised macOS/Windows device, and F3's remote-uninstall action is Android-only outside a supervised/MDM-enrolled device. This is disclosed to the buyer at template-customization time (§3 of [licensing-billing-spec.md](./licensing-billing-spec.md)) rather than worked around with elevated covert access.

## 8. Offline Coverage Summary

Per [offline-sync-spec.md](./offline-sync-spec.md), every feature is tagged Full / Partial / None for offline operation:

- **Full offline (enforcement + capture, zero connectivity required): 12 features** — F1, F2, F3 (install gate + block-from-running only — cached allowlist, checked locally), F5, F6, E1, E2, E5, E6, E8, M5, M6. These are the ones that matter most for the "it should just work with no internet" requirement, and they're exactly the device-local enforcement/capture features — the core of the product's value.
- **Partial offline (detection/capture works locally, human-facing alert or upload deferred): 4 features** — F4, E4, M4 (persists once triggered), M7.
- **None / inherently needs connectivity (server-initiated commands or server-side aggregation): remaining** — M2, M3, M8, and F3's **remote-uninstall** action specifically (all server-initiated commands, same pattern), plus M1/M9/E3/E7/F7 (first enrollment or server-side views/aggregation).

**Net result: the large majority of the product's actual monitoring/enforcement value works with zero internet connectivity.** The exceptions are either physically inherent to what the feature *is* (you cannot remotely lock an unreachable device — no vendor can) or server-side aggregation views that have nothing to show until data syncs. This asymmetry should be stated plainly in product marketing, not glossed over.
