# 3rdEye — Product Specification (Draft v0.1)

## 1. Product Vision

A **transparent, consent-based** device visibility and management platform for three audiences, unified under one architecture:

1. **Employers** — disclosed workforce device monitoring (productivity, DLP-lite, compliance).
2. **Parents** — transparent parental controls for family devices.
3. **IT/Admins** — MDM and anti-theft management for owned fleets.

**Core design principle: no hidden mode, ever.** Every monitored device runs a visible agent: a persistent notification/icon (mobile) or menu-bar/tray icon (desktop), an in-app "What is being tracked" screen, and a tamper-evident log if the agent is disabled. This is a product and legal requirement, not just an ethical preference — it's what keeps this out of spyware/stalkerware territory and able to ship on app stores.

## 2. Non-Negotiable Constraints

- No stealth/hidden operating mode. No hidden icon, no hidden process, no silent camera/mic activation.
- Every data category collected must be shown to the **monitored person**, not just the admin, before or at first use.
- Monitored user (employee, teen, device holder) gets a local "what's been collected about me" view.
- Camera/mic access, if offered at all, requires an active, visible-to-the-user indicator every single time (OS-level indicators on iOS/Android/macOS/Windows already enforce this — we don't try to suppress them).
- Clear onboarding consent flow with explicit acceptance, stored with timestamp, re-shown on major policy changes.
- Data retention limits + export/delete controls for compliance (GDPR/CCPA-style rights for the monitored person where applicable).

## 3. Target Devices / Platforms

The agent ships on **all four major platforms — Android, iOS, macOS, Windows** — from v1. This is a cross-cutting requirement for every pillar (Family, Employer, Fleet), not a per-tier choice:

| Platform | Agent form factor | Primary enrollment mechanism |
|---|---|---|
| **Android** | App with persistent notification icon | Family Link-style parental APIs (Family) / Work Profile via Android Enterprise (Employer) / Android Enterprise fully-managed + zero-touch or QR (Fleet) |
| **iOS** | App + Screen Time / Family Controls integration | Family Sharing + Family Controls framework (Family) / Managed App Config in a Apple Business Manager-supervised context (Employer) / Automated Device Enrollment (DEP) via Apple Business Manager (Fleet) |
| **macOS** | Menu-bar app, always visible | Local install + consent flow (Family, less common) / Managed login + profile (Employer) / MDM profile via Apple Business Manager (Fleet) |
| **Windows** | Tray app, always visible | Local install + consent flow (Family, less common) / Managed install (Employer) / Windows Autopilot + Intune-style MDM protocol (Fleet) |

Shared rules across all four platforms:
- The visible agent indicator (notification/tray/menu-bar icon) is **mandatory on every platform** — no platform gets a hidden-mode exception.
- Each platform's own OS-level "managed by" indicator (where one exists — iOS/Android/Windows/macOS MDM badges) is used as-is, never suppressed or hidden by our agent.
- Feature availability varies per platform/OS API (e.g., iOS doesn't allow generic background keylogging — and we don't want it to; see constraints in §2). Each tier spec's "Platform Notes" section documents what's actually achievable per OS, and the [licensing-billing-spec.md](./licensing-billing-spec.md) meter catalog should only expose features that are actually implementable on a given platform (e.g., don't let a buyer toggle "screenshot capture" for a pure-iOS personal device fleet if the OS doesn't support it in that enrollment mode — the checkout UI must gate feature toggles by selected platform/enrollment type).
- One shared client codebase/SDK per platform across all three pillars (per §4 Architecture below) — a single Android app binary serves Family, Employer, and Fleet use cases, mode-gated by the `LicenseAgreement` feature flags, not three separate apps.
- **Design goal: 92% of catalogued features (22 of 24) run on all four platforms**, each via that OS's own sanctioned native API — see [feature-list.md §7](./feature-list.md#7-cross-platform-coverage-summary) for the full per-feature platform matrix and the two deliberate, disclosed exceptions (mobile-only communication metadata; supervised-device-only mobile screenshots).

## 4. Architecture

**Client-Server, three device-side agent variants sharing one SDK:**

- **Agent (Client App)** — Android, iOS, Windows, macOS. One codebase, mode-gated by license type (Employer / Family / Fleet).
- **Admin Console (Web)** — policy configuration, live dashboard, reports, alerts.
- **Companion App (Mobile)** — for parents/admins to get push alerts (geofence, app install, low battery, etc).
- **Backend** — multi-tenant API, auth (SSO for employer tier), event ingestion, policy engine, notification service.

## 5. Roles (RBAC)

| Role | Scope |
|---|---|
| Super Admin (org owner) | Full org config, billing, data export/delete, user management |
| Manager/Viewer (employer tier) | View assigned employees' reports only, no policy edit |
| Parent (family tier) | Full control over their own family devices |
| IT Admin (fleet tier) | Device enrollment, remote wipe/lock, compliance policy |
| Monitored User | Visible agent, sees own "collected data" screen, can see policy, cannot disable without admin notice |

## 6. Feature Set by Pillar

### A. Employer Monitoring (disclosed)
- App & website usage time (category-level and/or app-level, configurable)
- Active/idle time, productivity scoring
- Optional: periodic screenshot **with visible on-screen capture indicator**, admin-configurable frequency, employee-visible log of when screenshots were taken
- DLP-lite: alert on sensitive file types moved to USB/cloud (metadata only, not full keylogging)
- Does **not** include: keystroke content capture, covert audio/video, personal browsing outside work profile

### B. Parental Controls (transparent)
- Screen time limits & schedules, per-app
- Content/web filtering (category-based + custom block/allow lists)
- App install visibility & approval requests
- Location sharing + geofence alerts (always visible to child via OS location indicator + in-app notice)
- Communication **metadata** (contact added, call/SMS counts) — not message content, to stay within platform policy and avoid crossing into interception law
- Child-facing dashboard: "Here's what your parent can see"

### C. MDM / Anti-Theft (fleet)
- Device enrollment (Android Enterprise, Apple Business Manager/DEP, Windows Intune-style, macOS MDM profiles)
- Remote lock, remote wipe, lost-mode with recovery contact screen
- Location tracking for company-owned devices (disclosed in employment/device agreement)
- Compliance policies: OS version enforcement, disk encryption check, passcode enforcement
- Asset inventory: installed apps, OS version, storage, battery health

## 7. Mode Matrix (replaces the old "stealth/visible/selective" framing)

| Tier | Default Visibility | Who sees agent | Toggle-off behavior |
|---|---|---|---|
| Employer | Persistent tray/notification icon + onboarding consent screen | Employee always | Disabling notifies admin (not silent) |
| Family | In-app icon + child dashboard | Child always | Disabling notifies parent |
| Fleet (company-owned) | MDM profile indicator (OS-native) | Device user always | Enforced via MDM profile; removal = compliance flag, not covert |

## 8. Platform Constraints (carried over from research, still accurate)

- **iOS**: Enforced via Screen Time API / Family Controls framework (parental), or MDM/DEP (fleet/employer-owned). No general background keylogging — not fighting this, building within it.
- **Android**: Device Policy Controller (Android Enterprise) for fleet; Accessibility Service only for parental app-blocking, disclosed to user at permission grant.
- **Windows/macOS**: Agent runs as a visible tray/menu-bar app; admin install requires local admin rights, same as any legitimate MDM/monitoring tool (Jamf, Intune, Teramind, ActivTrak).

## 9. Compliance Considerations

- Store consent records (who agreed, when, to what policy version).
- Jurisdiction-aware defaults: some regions require explicit employee consent by law (e.g., parts of the EU) — block screenshot/location features until consent flag is set for that user.
- No message-content interception (call recording / SMS content) — this crosses into wiretap-law territory even with consent in many jurisdictions; stick to metadata.
- Data minimization: configurable retention windows, auto-purge.

## 10. Open Questions for Next Pass
- Build vs. license OS-level MDM frameworks (Apple Business Manager, Android Enterprise) vs. partner with existing MDM vendor?
- Do we need message-content features at all, or stay metadata-only permanently?

Note: a transparent, no-covert-mode design (§2) is necessary but not sufficient to avoid AV/EDR flagging — see [av-edr-compliance-spec.md](./av-edr-compliance-spec.md) for the code-signing, reputation-building, and vendor-allowlisting workstream required on top of it.

For what actually ships first and in what order, see [mvp-build-plan.md](./mvp-build-plan.md) — this full vision is the target state; that doc is the path to it.

For the concrete backend/services/data-flow/tech-stack design underneath all of the above, see [system-architecture-spec.md](./system-architecture-spec.md) — it merges the per-tier "first pass" data models into one unified schema and defines Phase 0's actual deliverables.

## 11. Offline-First Requirement

Every agent must enforce policy and capture data with **zero internet connectivity**, syncing automatically once online — the Admin Console only ever reflects synced state. Full analysis of what's genuinely achievable offline per feature (and the honest exceptions — remote lock/wipe/policy-push are server-initiated commands that cannot function without connectivity, same as any MDM vendor) is in [offline-sync-spec.md](./offline-sync-spec.md).

## 12. Licensing & Purchase Journey

The three tiers above are no longer three separate products with three separate sign-ups. They are unified into **one purchase flow with customizable, usage-based license templates** — see [licensing-billing-spec.md](./licensing-billing-spec.md) for the full purchase journey, meter catalog, and billing data model. In short: a buyer selects a starting template (Family/Workforce/Fleet/Custom), toggles individual features from any pillar, sees a live usage-based price estimate, and the resulting `LicenseAgreement` drives both provisioning and the on-device consent/disclosure screens from a single source of truth.

The public, unauthenticated entry point into that purchase flow — the marketing/landing site a buyer actually lands on before any of the above — is specced separately in [marketing-site-spec.md](./marketing-site-spec.md), scoped to launch (Family tier only, per mvp-build-plan.md Phase 1–2).
