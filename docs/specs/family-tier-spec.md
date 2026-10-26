# 3rdEye — Family Tier Spec (Draft v0.1)

Scope: first buildable slice of the platform defined in [product-spec.md](./product-spec.md). Transparent parental controls, child always aware of what's tracked.

## 1. Users

- **Parent** — sets up family, invites children's devices, configures policy, views dashboard.
- **Child** — uses the monitored device, sees a visible agent + their own "what my parent can see" screen.

## 2. MVP Feature Scope (cut line for v1)

**Platform principle for this tier: every feature targets all four platforms (Android, iOS, macOS, Windows) unless the feature is physically meaningless on a platform (e.g., SMS/call metadata doesn't exist on a desktop OS).** Where a platform's native API gives a weaker version of a feature, we build to the strongest available mechanism per OS rather than dropping the feature — see §2.1 per-feature platform analysis.

In scope:
1. **Screen time limits & schedules** (daily limit, bedtime schedule, per-app limits) — **enforced as an actual login/session lockout on every platform**, not just a usage report. When a limit or schedule window is hit, the device blocks further use (locks the screen / signs the user out / blocks app launch) using each OS's native enforcement mechanism — see §2.1.
2. App install visibility & approval (parent notified; optional approval-required mode for new installs/app-store purchases)
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
| App install approval | Family Link "ask to install" for Play Store apps | Ask to Buy / Screen Time app-install restriction | Screen Time app restrictions (App Store apps); traditional non-Store Mac apps are a known gap — flagged below | Family Safety app/game approval (Microsoft Store apps); traditional Win32 installers are a known gap — flagged below |
| Location + geofence | Native location API, always-on indicator | Native location API, always-on indicator | Native macOS location services (laptops have Wi-Fi/GPS-assisted positioning) | Native Windows location services (varies by hardware — many desktops lack GPS, so accuracy is Wi-Fi/IP-based only) |
| Communication metadata (calls/SMS) | Native (telephony exists) | Native (telephony exists) | **N/A — no telephony stack on desktop OS**, excluded | **N/A — excluded** |

**Known gap to flag honestly, not hide:** on macOS/Windows, a determined teen could still install a traditional (non-App-Store/non-Microsoft-Store) application outside the managed install restriction. Closing that fully requires Fleet-tier-style MDM enrollment (supervised Mac / Windows provisioning), which is heavier than a typical home setup. We should surface this as a documented limitation in the parent-facing help content rather than attempt a workaround that would require elevated, less transparent access.

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
- Dashboard: per-child device list, today's screen time vs. limit, last known location + geofence events, pending app-install approvals, content-filter block log (what got blocked, not full browsing history).
- Alerts feed: bedtime limit hit, geofence entry/exit, new app install, agent disabled.
- Policy editor: adjust limits/schedules/filters per child or per device.

## 4. Data Model (first pass)

- `Family` (id, parent_user_ids[])
- `ChildProfile` (id, family_id, name, age_band, device_ids[])
- `Device` (id, child_profile_id, platform, enrollment_status, agent_version, last_seen)
- `ConsentRecord` (id, device_id, policy_version, accepted_at, accepted_by)
- `Policy` (id, child_profile_id, screen_time_rules{daily_limit, bedtime_window, per_app_limits, lockout_action}, content_filter_rules, geofence_rules)
- `UsageEvent` (device_id, app_id, category, start_ts, end_ts)
- `LocationEvent` (device_id, lat, lon, geofence_id_if_any, ts)
- `AlertEvent` (device_id, type, payload, ts, acknowledged)

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
