# 3rdEye — Employer Tier Spec (Draft v0.1)

Scope: second buildable slice of the platform defined in [product-spec.md](./product-spec.md). Disclosed workforce monitoring — employee always knows the agent is present and what it reports.

> **Deferred until [mvp-build-plan.md](./mvp-build-plan.md) Phase 4.** Phase 1–3 build Family tier only; nothing here should be built before then.

## 1. Users

- **Super Admin** — org owner, billing, policy, full data access/export/delete.
- **Manager/Viewer** — sees reports for assigned employees only, cannot edit policy or export raw data.
- **Employee (Monitored User)** — uses the work device/profile, sees a visible agent and a personal "what's collected about me" view.

## 2. MVP Feature Scope (cut line for v1)

In scope:
1. App & website usage time, categorized (productive/neutral/distracting, admin-configurable mapping)
2. Active/idle time and per-app focus duration
3. Productivity summary reports (daily/weekly), per employee and team rollups
4. Optional periodic screenshots — off by default, admin opts in per-team, **visible on-device capture indicator every time**, employee can see the screenshot log timestamp (not necessarily the image itself, configurable)
5. DLP-lite alerts: sensitive file type (e.g. .xlsx, .pdf matching admin-defined patterns) copied to USB or personal cloud storage — metadata only (filename, destination, timestamp), not file contents
6. Employee dashboard: "What's being tracked" screen + their own usage summary

Explicitly out of scope for v1:
- Keystroke content logging (no keylogger, period)
- Covert or scheduled webcam/mic capture
- Full browsing history / URL-level logging beyond domain+category
- Personal device monitoring outside a company-managed work profile/container

## 3. Core Flows

### 3.1 Org Onboarding (Admin)
1. Admin creates org, invites Managers, sets global default policy (categories, screenshot on/off, DLP rules).
2. Admin invites employees via email/SSO; enrollment is tied to a **work profile/container** on BYOD, or full device management on company-owned hardware (reuses Fleet-tier enrollment when device is company-owned).

### 3.2 Employee Onboarding
1. Employee receives enrollment link, installs agent (or work-profile container on Android, or company portal on macOS/Windows).
2. **Mandatory consent screen** before any data collection starts: plain-language list of exactly what's tracked (app/site categories, active time, optional screenshots, DLP metadata alerts) and what's explicitly NOT tracked (keystrokes, personal device, personal apps outside work profile, mic/camera).
3. Employee acknowledges; timestamp + policy version logged (same `ConsentRecord` model as Family tier, reused).
4. Where legally required (e.g. parts of the EU, some US states), consent must be a standalone acceptance step, not bundled into an employment contract — flag jurisdiction at org setup and gate screenshot/location features accordingly until per-user consent is recorded.
5. Agent icon appears in menu bar/tray (desktop) or persistent notification (mobile); same non-hideable rule as Family tier.

### 3.3 Daily Use (Employee)
- Agent visible at all times during work hours tracking.
- Employee can open agent → "What's tracked about me" → live mirror of their own usage data, screenshot log (timestamps + optionally thumbnails), DLP alerts triggered on their activity.
- Outside configured work hours / on personal profile: agent shows idle/paused state, explicitly not collecting.
- Disabling/uninstalling agent → notifies Manager/Admin (not covert), same pattern as Family tier.

### 3.4 Daily Use (Admin/Manager)
- Team dashboard: usage/productivity rollups, screenshot review queue (if enabled), DLP alert feed.
- Manager view scoped to assigned employees only (RBAC enforced at query level, not just UI).
- Policy editor: category mapping, screenshot cadence, DLP rule patterns, work-hours schedule.
- Export/report generation (CSV/PDF) — gated to Super Admin, logged for audit.

## 4. Data Model

Covered by the unified model in [system-architecture-spec.md](./system-architecture-spec.md) §3 (`Org`, `Team`, `Employee`, `Device`, `ConsentRecord`, `Policy`, `AuditLogEntry`). This tier contributes `ScreenshotEvent` and `DlpAlertEvent`.

## 5. Platform Notes

- **Windows/macOS**: Agent runs as a visible tray/menu-bar app, standard local-admin install — same category as Jamf/Intune/ActivTrak/Teramind, not a rootkit-style hook. No global keyboard hook; app/window-focus tracking via OS-provided accessibility/window APIs only.
- **Android/iOS (BYOD)**: Use **work profile (Android Enterprise) / Managed App Config (Apple)** containers so monitoring is scoped to the work container only, never the personal side of the device — this is both a compliance requirement and a trust feature worth marketing.
- **Company-owned mobile devices**: Full MDM enrollment reuses Fleet-tier spec (next doc) rather than duplicating.

## 6. Compliance Notes (employer-specific)

- Jurisdictions with **mandatory advance written notice** for monitoring (e.g., Connecticut, Delaware, parts of the EU) — org setup wizard should surface a jurisdiction checklist and block relevant features until the admin confirms notice was given, with the `ConsentRecord` as the audit trail.
- Screenshot/DLP features should default **off** at org creation; admin must explicitly opt in per team — avoids "monitoring maximalism" as a default and keeps the product distinct from stealth tools in both design and legal posture.
- Data retention: configurable per org, with a sane default (e.g. 90 days for usage data, 30 days for screenshots) and auto-purge.

## 7. Success Metrics (draft)
- Consent completion rate at enrollment
- % of orgs leaving screenshots/DLP off vs. on (signal on whether "visibility without surveillance" resonates)
- Agent-disabled rate per employee (fairness signal, same as Family tier)
- Manager weekly active usage of dashboard

## 8. Open Questions
- Should screenshot thumbnails be visible to the employee by default, or just the timestamp log (configurable per org, but what's the *default*)?
- How do we handle shared/kiosk devices (e.g., retail) where "employee" isn't 1:1 with device?
- SSO/SCIM requirements for larger orgs — v1 or v2?
