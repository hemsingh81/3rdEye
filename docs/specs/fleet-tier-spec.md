# 3rdEye — Fleet / MDM Tier Spec (Draft v0.1)

Scope: third buildable slice of the platform defined in [product-spec.md](./product-spec.md). MDM and anti-theft management for company-owned device fleets. This tier also underpins company-owned device enrollment referenced by the Employer tier.

> **Deferred until [mvp-build-plan.md](./mvp-build-plan.md) Phase 5.** Nothing here should be built before Phase 5 starts.

## 1. Users

- **IT Admin (Super Admin)** — enrolls devices, sets compliance policy, remote lock/wipe, full fleet visibility.
- **IT Viewer** — read-only fleet inventory/compliance status, no destructive actions.
- **Device User** — the employee/staff member holding the company-owned device; sees the MDM profile/management indicator the OS already surfaces, plus our own "this device is managed" screen.

## 2. MVP Feature Scope (cut line for v1)

In scope:
1. Device enrollment via platform-native programs: **Apple Business Manager / Automated Device Enrollment (DEP)**, **Android Enterprise (zero-touch or QR)**, **Windows Autopilot / Intune-style enrollment**, **Apple MDM profiles for macOS**.
2. Remote lock, remote wipe, "lost mode" with a custom recovery-contact lock screen.
3. Compliance policy checks: OS version minimum, disk/device encryption enabled, passcode/biometric enforced, jailbreak/root detection.
4. Asset inventory: installed apps, OS version, storage free/used, battery health, last check-in time.
5. Location tracking for company-owned devices — always disclosed via the device-use agreement signed at enrollment, and surfaced via the OS's own location indicator (no suppression).
6. Fleet dashboard: device list with compliance status (compliant/non-compliant/at-risk), bulk actions (push policy, lock, wipe).

Explicitly out of scope for v1:
- App/usage-content monitoring beyond inventory (that's the Employer tier's job; Fleet tier only manages the device, doesn't watch what's done on it)
- Any covert surveillance feature of any kind — same hard constraint as every other tier

## 3. Core Flows

### 3.1 Fleet Setup (IT Admin)
1. Admin connects org's Apple Business Manager / Android Enterprise / Microsoft Entra tenant (OAuth/API credentials).
2. Admin defines compliance policy template(s) (e.g., "Standard Laptop," "Field Tablet").
3. Admin pre-stages devices by serial number/IMEI (zero-touch) or generates QR/enrollment profile for manual setup.

### 3.2 Device Enrollment (new device, out of box)
1. Device user powers on a new company device → OS-native zero-touch enrollment kicks in automatically (DEP/Android Enterprise/Autopilot) — this is the standard, expected MDM experience, not something we build around covertly.
2. Device user sees the **device use agreement** (disclosure: this device is company-owned, management profile installed, location/compliance/inventory visible to IT, no personal-use monitoring beyond this).
3. Acceptance timestamp + policy version logged (same `ConsentRecord` shape reused across all three tiers).
4. OS installs the MDM profile/device policy controller — this is what gives the OS-level "Managed by [Org]" indicator, which we never try to hide or suppress.

### 3.3 Daily Use (Device User)
- OS shows its native "This device is managed by [Org]" indicator (Settings app badge on iOS/Android, same on Windows/macOS) — this is enough disclosure on its own, but we add our own simple screen in-app: "What IT can do: lock, wipe, see device location & compliance status. What IT does NOT do: see your apps/browsing" (unless this device is *also* enrolled in Employer tier, in which case that tier's disclosure applies additionally).
- If device reports non-compliant (e.g. encryption disabled), user sees an in-app prompt to fix it before continuing — not silent enforcement.

### 3.4 Daily Use (IT Admin)
- Fleet dashboard: compliance status per device, last check-in, pending actions.
- Lost/stolen device flow: Admin flags device lost → triggers lost-mode lock screen (custom message + recovery contact) → location polling increases in frequency → option to remote wipe if unrecoverable.
- Bulk policy push (e.g., force OS update, revoke app).
- Audit log of every lock/wipe/location-query action (who did it, when) — same `AuditLogEntry` shape as Employer tier.

## 4. Data Model

Covered by the unified model in [system-architecture-spec.md](./system-architecture-spec.md) §3 (`Org`, `Device` with `enrollment_type`, `ConsentRecord`, `AuditLogEntry`). This tier contributes `DeviceFleetPolicy`, `ComplianceCheckEvent`, and `LostModeEvent`.

## 5. Platform Notes

- **iOS/macOS**: Apple Business Manager + DEP for zero-touch; MDM protocol (APNs-based) for remote commands. No private APIs — wipe/lock/locate are all first-class supervised-device MDM commands.
- **Android**: Android Enterprise "fully managed" mode via zero-touch enrollment or QR; Device Policy Controller handles lock/wipe/compliance.
- **Windows**: Windows Autopilot + Intune-style MDM protocol (or a self-hosted equivalent of the same open management protocol) for enrollment and remote commands.
- All four platforms expose their *own* OS-level "this device is managed" UI — we lean on that rather than reinventing disclosure, and layer a friendlier explainer screen on top.

## 6. Relationship to Other Tiers

- A device can be `fleet`-enrolled (company owns it, IT manages the device) **and** `employer`-enrolled (same org monitors usage within a work profile) simultaneously — two separate consent records, two separate disclosure screens, because they're legally/functionally distinct even when run by the same admin org.
- Family tier devices are never fleet-enrolled (different ownership model entirely) — kept as fully separate `enrollment_type`.

## 7. Success Metrics (draft)
- Enrollment success rate (zero-touch completion without manual IT intervention)
- Mean time to lock/wipe a reported-lost device
- Fleet compliance rate (% devices passing policy checks)
- False-positive "lost" flags (signal on UX clarity of the lost-mode trigger)

## 8. Open Questions
- Do we build our own MDM server from scratch, or integrate with an existing MDM vendor's API (e.g., white-label on top of a provider) for v1 to avoid rebuilding Apple/Google/Microsoft protocol support?
- Self-service lost-mode trigger for the device user themselves (e.g., "I think I lost my laptop" button), or IT-admin-only?
- Multi-org device transfer (device reassigned between employees) — wipe-and-reissue flow needed for v1?
