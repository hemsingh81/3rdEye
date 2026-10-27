# 3rdEye — Family Tier Spec (Draft v0.1)

Scope: first buildable slice of the platform defined in [product-spec.md](./product-spec.md). Transparent parental controls, child always aware of what's tracked.

## 1. Users

- **Parent** — sets up family, invites children's devices, configures policy, views dashboard.
- **Child** — uses the monitored device, sees a visible agent + their own "what my parent can see" screen.

## 2. MVP Feature Scope (cut line for v1)

**Platform principle for this tier: every feature targets all four platforms (Android, iOS, macOS, Windows) unless the feature is physically meaningless on a platform (e.g., SMS/call metadata doesn't exist on a desktop OS).** Where a platform's native API gives a weaker version of a feature, we build to the strongest available mechanism per OS rather than dropping the feature — see §2.1 per-feature platform analysis.

In scope:
1. **Screen time limits & schedules** (daily limit, bedtime schedule, per-app limits) — **enforced as an actual login/session lockout on every platform**, not just a usage report. When a limit or schedule window is hit, the device blocks further use (locks the screen / signs the user out / blocks app launch) using each OS's native enforcement mechanism — see §2.1.
2. **App control — default-deny, not just notify.** No app installs unless the parent approved it from the dashboard first; an app not on the approved list is **blocked from launching** even if it ends up installed some other way; the parent can **uninstall** a non-approved app remotely where the platform allows it. See §2.1 for exactly what "blocked" vs. "uninstalled" means per platform — these are two different capabilities, not one.
3. Web content filtering (category blocklist: adult/violence/gambling + custom block/allow list)
4. Location sharing + geofence alerts ("arrived at school", "left home") — on devices with location capability
5. Communication metadata (contact added, call/SMS counts, mobile only — no content, see exclusions)
6. Child dashboard: shows exactly what's being collected, in plain language, live
7. Parent dashboard: device list, today's usage summary, alerts feed

Explicitly out of scope for v1 (revisit later):
- Message/call content monitoring (metadata-only, and only as a v2+ discussion — legal risk)
- Social media content scanning / sentiment analysis
- Browser history full-URL logging (category + domain-level only in v1)
- Multi-parent / co-parenting permission splits (v2)

### 2.1 Per-Feature Platform Analysis (why "all platforms" is actually achievable without a covert agent)

Each feature below relies on a **native, OS-sanctioned enforcement API** per platform — no custom kernel hooks, no jailbreak/root dependency, no suppression of the OS's own "managed" indicators. This is what keeps "enforced lockout" from sliding into stealth territory: the lock screen, the Screen Time badge, the Family Safety notice — all OS-native UI, always visible to the child.

| Feature | Android | iOS | macOS | Windows |
|---|---|---|---|---|
| Screen time limit + **lockout** | Family Link Device Policy Controller — blocks app/device at limit, shows Family Link lock screen | Screen Time / Family Controls (`ManagedSettings` + `DeviceActivity`) — blocks app launch or whole-device at limit via Apple's own Downtime UI | Screen Time (Family Sharing, parent-managed) — Downtime locks the Mac with Apple's native screen, same framework as iOS | Microsoft Family Safety — screen time limit signs the child's account out / blocks sign-in at limit, native Windows lock screen |
| Content filtering | Family Link + Android content filter / Safe Browsing DNS | Screen Time content restrictions + Network Extension (content filter provider) | Screen Time content restrictions (shared Apple framework with iOS) + Network Extension | Microsoft Family Safety web filtering (Edge + SafeSearch enforcement at account level) |
| App control — **install gate** | Family Link "ask to install" set to **required**, default-deny for Play Store apps | Ask to Buy, default-deny — all iOS installs go through the App Store, so this one switch covers the whole install surface | Screen Time app restrictions (App Store apps only); traditional non-Store Mac apps install outside this gate — known gap, flagged below | Family Safety app/game approval (Microsoft Store apps only); traditional Win32 installers install outside this gate — known gap, flagged below |
| App control — **block from running** (if installed anyway) | Device Policy Controller can block ANY installed app from launching, Store or not — closes the gap fully | Screen Time "Allowed Apps" hides/blocks any app, Store or not (sideloading is already closed off by iOS itself) | Screen Time app restriction blocks a **Store** app from opening; a non-Store app can't be blocked from running without Fleet-tier-style supervision — same known gap | Family Safety can block a **Store** app from opening; a non-Store `.exe` can't be blocked from running without Fleet-tier-style supervision (AppLocker/WDAC via MDM) — same known gap |
| App control — **remote uninstall** | Device Policy Controller can remove any app remotely — full support | No remote-uninstall command on unsupervised Family Sharing; parent can only block the app from running (above), not remove it, unless the device is also under supervised MDM | Same limit as iOS — block-from-running only, unless supervised MDM | Same limit as iOS — block-from-running only, unless supervised MDM |
| Location + geofence | Native location API, always-on indicator | Native location API, always-on indicator | Native macOS location services (laptops have Wi-Fi/GPS-assisted positioning) | Native Windows location services (varies by hardware — many desktops lack GPS, so accuracy is Wi-Fi/IP-based only) |
| Communication metadata (calls/SMS) | Native (telephony exists) | Native (telephony exists) | **N/A — no telephony stack on desktop OS**, excluded | **N/A — excluded** |

**Known gap to flag honestly, not hide:** on macOS/Windows, a determined teen could still install a traditional (non-App-Store/non-Microsoft-Store) application outside the managed install gate, and — unlike Android — 3rdEye can't remotely uninstall it or block it from running on an unsupervised consumer device. Closing that fully requires Fleet-tier-style MDM enrollment (supervised Mac/Windows provisioning), which is heavier than a typical home setup. Surface this as a documented limitation in parent-facing help content, with an explicit upsell to "supervised device" setup for a parent who wants full enforcement, rather than attempt a workaround that would require elevated, less transparent access.

**Why "block" and "uninstall" are listed separately:** blocking an app from launching is enforced **locally**, from the device's own cached allowlist — it works with zero connectivity, the same as the F1 lockout. Remote uninstall is a **server-initiated command** (like Fleet tier's M2/M3) — it can only reach a device that's online, and on Android it reuses the same Device Policy Controller channel Fleet tier uses for M8.

## 3. Core Flows

### 3.1 Onboarding (Parent)
1. Parent creates account, creates a "Family."
2. Parent adds a child profile (name, age band — age band drives default policy templates, e.g. stricter defaults for under-13).
3. Parent generates a device enrollment code/QR.

### 3.2 Onboarding (Child device)
1. Child (or parent, physically) installs the agent app, enters enrollment code.
2. **Consent screen is mandatory and cannot be skipped**: shows exactly what categories will be visible to the parent (screen time, location, app installs, web category, not message content), in child-readable language appropriate to age band.
3. Child taps "I understand" (or parent taps it for younger kids) — this timestamp + policy version is logged.
4. OS permission prompts follow (Location, Screen Time/Family Controls API, Notification access) — standard OS dialogs, never suppressed.
5. Agent icon appears in app list / persistent notification (per-platform) — cannot be hidden from the child.

### 3.3 Daily Use (Child)
- Agent runs visibly (notification icon on Android, Screen Time managed-by-parent indicator on iOS, menu bar icon on desktop if applicable).
- Child can open the agent anytime → "What my parent can see" screen → live mirror of parent dashboard's categories (not necessarily every granular data point, but accurate categories + today's summary).
- If child disables/uninstalls agent: parent gets an immediate alert ("Agent removed from [device] at [time]") — not covert, but also not silently allowed; policy can require the device to re-enroll before certain features (e.g. school wifi) are usable, depending on fleet-style enforcement on owned devices.

### 3.4 Daily Use (Parent)
- Dashboard: per-child device list, today's screen time vs. limit, last known location + geofence events, pending app-install approvals, content-filter block log (what got blocked, not full browsing history), and an **installed-app inventory** per device (what's actually on it, approved or not).
- An app the parent never approved shows a **"Block"** action (stops it launching, works even if the device is offline once the policy syncs) and, where the platform supports it (Android always; iOS/macOS/Windows only on a supervised/MDM-enrolled device), an **"Uninstall"** action.
- A device that hasn't synced in 24h (configurable) shows a third status, **"Needs attention,"** alongside Active/Locked — see offline-sync-spec.md §5 (X9). This can't tell the parent *why* it went quiet, only that it did.
- Alerts feed: bedtime limit hit, geofence entry/exit, new app install request, unapproved app detected, agent disabled, device needs attention.
- Policy editor: adjust limits/schedules/filters per child or per device.

## 4. Data Model

Covered by the unified model in [system-architecture-spec.md](./system-architecture-spec.md) §3 (`Family`, `ChildProfile`, `Device`, `ConsentRecord`, `Policy`, event tables). This tier contributes `screen_time_rules.lockout_action` and the geofence/location event shapes.

## 5. Platform Notes

All four platforms are first-class for v1 — see §2.1 for the full per-feature native-API mapping. Summary:

- **iOS**: Apple's **Screen Time API / Family Controls / DeviceActivity framework**. Only Apple-sanctioned path — no private API usage, no jailbreak dependency. Covers lockout enforcement, per-app limits, and content filtering (via Network Extension).
- **Android**: **Family Link-style Device Policy Controller** for lockout + app approval; native content-filter/Safe Browsing APIs for filtering. Accessibility Service only if genuinely needed for a specific filter mechanism, and only with explicit in-flow disclosure of why it's requested.
- **macOS**: Shares Apple's **Screen Time / Family Sharing framework** with iOS — Downtime enforcement, content restrictions, and app-install restriction all apply.
- **Windows**: **Microsoft Family Safety** — screen time limits that sign the child's account out at the limit, native lock screen, Edge/SafeSearch content filtering, Microsoft Store app approval.
- **Agent form factor on desktop**: visible menu-bar (macOS) / tray (Windows) icon, same mandatory-visibility and consent rules as mobile.

## 6. Success Metrics (draft)
- Consent-flow completion rate (did child actually see & accept)
- Agent-disabled rate (proxy for whether the tool feels fair vs. adversarial)
- Parent weekly active usage of dashboard
- Support tickets re: "why can't I see X" (complaints about missing covert features = useful signal we're differentiating correctly, not a gap to fill)

## 7. Open Questions
- Age-band default policy templates — how many bands (e.g. 5-8, 9-12, 13-15, 16-17)?
- Do we need a "pause monitoring" button the child can see was used (vs. parent being able to silently pause — avoid asymmetry)?
- iOS Family Controls framework requires the *parent's* device to set up Screen Time for a *child's* device via Family Sharing — confirm this doesn't require the child device to be an Apple ID under 13 Family Sharing, which constrains teen use cases.
