# 3rdEye — System Architecture Spec (Draft v0.1)

Scope: the concrete technical backbone underneath every tier spec and the [mvp-build-plan.md](./mvp-build-plan.md) phases. Unifies the overlapping data models scattered across [family-tier-spec.md](./family-tier-spec.md), [employer-tier-spec.md](./employer-tier-spec.md), [fleet-tier-spec.md](./fleet-tier-spec.md), and [licensing-billing-spec.md](./licensing-billing-spec.md) into one schema, and defines the services, data flow, and tech stack for both development and production.

## 1. High-Level Component Map

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Android    │   │     iOS      │   │    macOS     │   │   Windows    │
│    Agent     │   │    Agent     │   │    Agent     │   │    Agent     │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │                 │
       └────────────┬────┴────────┬────────┴────────┬────────┘
                     │  HTTPS/TLS + platform push (APNs/FCM/WNS) │
                     ▼
            ┌────────────────────┐
            │   API Gateway /     │   (auth, rate limiting, request routing)
            │   Edge Layer        │
            └─────────┬──────────┘
                       │
       ┌───────────────┼───────────────┬────────────────┬─────────────────┐
       ▼               ▼               ▼                ▼                 ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ ┌─────────────┐
│   Policy &   │ │   Event      │ │  Metering &  │ │   Notification   │ │   MDM       │
│  Consent Svc │ │  Ingestion   │ │  Billing Svc │ │   Service         │ │  Command Svc │
└─────────────┘ └──────┬──────┘ └─────────────┘ └─────────────────┘ └─────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  Event Stream /     │  (buffers UsageEvent, LocationEvent,
              │  Queue              │   ScreenshotEvent, DlpAlertEvent, etc.)
              └─────────┬──────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  Primary Database   │  (Org/Family, Device, ConsentRecord,
              │  (relational)       │   Policy, LicenseAgreement, invoices)
              └───────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  Analytics / Event   │  (UsageEvent/LocationEvent history,
              │  Store (columnar)    │   feeds dashboards + metering)
              └───────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │   Admin Console      │  (web app: Family/Employer/Fleet
              │   (Web Frontend)     │   dashboards, policy editor, checkout)
              └───────────────────┘
```

## 2. Services (Production)

| Service | Responsibility | Owns these entities |
|---|---|---|
| **API Gateway / Edge** | TLS termination, auth token validation, rate limiting, routes to backend services | — |
| **Auth Service** | Account creation, login (parents/admins/IT), SSO for employer tier, device-to-account binding | `User`, `Session`, SSO config |
| **Policy & Consent Service** | Stores `Policy` per child/employee/device, serves current policy to agents, records `ConsentRecord` on accept, forces re-consent on policy-affecting change | `Policy`, `ConsentRecord` |
| **Event Ingestion Service** | Receives telemetry from agents (usage, location, screenshots metadata, DLP alerts, compliance checks) over authenticated HTTPS, validates against the device's current consented feature flags **before accepting the event** (an event for a disabled feature is rejected, not silently stored) | Writes to Event Stream |
| **Event Stream / Queue** | Durable buffer between ingestion and storage/processing (see §5) | — |
| **Metering & Billing Service** | Consumes events from the stream, aggregates into `UsageMeterEvent`, applies `LicenseAgreement` allowances/caps, generates `BillingPeriodInvoice` | `UsageMeterEvent`, `BillingPeriodInvoice`, `UsageCapEvent` |
| **Notification Service** | Pushes alerts to parent/admin apps and devices (geofence, limit hit, agent disabled, lost-mode, DLP alert) via APNs/FCM/WNS/email; runs a scheduled sweep comparing every `Device.last_synced_at` against `Policy.stale_device_alert_threshold_hours` and fires a one-time "needs attention" alert per device per threshold-crossing (X9, offline-sync-spec.md §5) | `AlertEvent` |
| **MDM Command Service** | Issues remote lock/wipe/locate/policy-push/**app-uninstall** commands via platform-native MDM protocols (APNs-based MDM, Android Enterprise DPC channel, Windows MDM/Autopilot channel) — **never a custom polling/beaconing protocol**, per av-edr-compliance-spec.md §5. App-uninstall is Android-native on any device; on iOS/macOS/Windows it only works once the device carries an MDM profile (Fleet-tier enrollment), same constraint as family-tier-spec.md §2.1 | `RemoteActionLog`, `LostModeEvent` |
| **Licensing & Checkout Service** | Serves the unified purchase journey (licensing-billing-spec.md §2), stores `LicenseTemplate`/`LicenseAgreement`, drives feature-flag provisioning | `LicenseTemplate`, `LicenseAgreement` |
| **Admin Console (Web Frontend)** | Dashboards, policy editor, checkout UI, audit log viewer | — (reads from above services only) |
| **Audit Service** | Records every policy change, data export, remote action, consent acceptance for compliance | `AuditLogEntry` |

## 3. Unified Data Model (replaces the per-tier "first pass" models)

The tier specs each sketched similar shapes independently; this is the single merged schema they all actually share. Field names are normalized across tiers via a shared `enrollment_type`.

```
Org (id, name, jurisdiction_settings, super_admin_ids[])
  └─ Team (id, org_id, manager_ids[])                      // employer tier only
  └─ Family (id)  -- modeled as a lightweight Org-like container for Family tier

ChildProfile (id, family_id, name, age_band)                // family tier only
Employee (id, org_id, team_id)                               // employer tier only

Device (
  id, owner_ref {family: ChildProfile.id | org: Employee.id | fleet: Org.id},
  platform [android|ios|macos|windows],
  enrollment_type [family|employer_workprofile|fleet_owned],
  mdm_profile_id_nullable,
  agent_version, enrollment_status, compliance_status, last_check_in, last_seen
)

LicenseAgreement (
  id, org_or_family_id, based_on_template_id_nullable,
  feature_flags{}, allowances{}, unit_prices{}, jurisdiction,
  accepted_at, accepted_by
)
LicenseTemplate (id, name, is_predefined, feature_flags{}, default_allowances{}, default_unit_prices{})

Policy (
  id, child_profile_id | team_id | fleet_policy_id,
  derived_from: LicenseAgreement.feature_flags,   // single source of truth, §6 of licensing-billing-spec.md
  screen_time_rules{}, content_filter_rules{}, geofence_rules{},
  app_control_mode [default_deny | notify_only],  // F3 — default_deny is the standard setting
  app_allowlist[] (app_id, approved_at, approved_by),
  category_map{}, screenshot_enabled, screenshot_interval, dlp_rules{}, work_hours{},
  min_os_version, require_encryption, require_passcode, check_in_interval
)

ConsentRecord (id, device_id, policy_version, accepted_at, accepted_by, feature_flags_snapshot{})

// Event tables (high volume, land in Event Stream → Analytics Store, not primary DB)
UsageEvent        (device_id, app_id, category, start_ts, end_ts)
LocationEvent      (device_id, lat, lon, geofence_id_nullable, ts)
ScreenshotEvent    (device_id, ts, thumbnail_ref, visible_to_employee)
DlpAlertEvent      (device_id, file_pattern_matched, destination_type, ts)
ComplianceCheckEvent (device_id, check_type, result, ts)
InstalledAppEvent  (device_id, app_id, install_source, is_approved, blocked_locally, detected_at)  // F3 inventory + block decision, evaluated against app_allowlist on-device
AlertEvent         (device_id, type, payload, ts, acknowledged)
RemoteActionLog    (device_id, actor_id, action_type [lock|wipe|locate|policy_push|app_uninstall], ts)  // F3's remote uninstall reuses this, same channel as M2/M3/M8
LostModeEvent      (device_id, triggered_by, ts, recovery_contact, resolved_at)

// Billing (primary DB, not the event stream — needs transactional integrity)
UsageMeterEvent      (id, license_agreement_id, meter_key, device_id_nullable, quantity, ts)
MeterDefinition      (id, feature_key, unit_label, default_unit_price)
BillingPeriodInvoice (id, license_agreement_id, period_start, period_end, line_items[], total)
UsageCapEvent        (license_agreement_id, meter_key, cap_value, triggered_at)

AuditLogEntry (actor_id, action, target_id, ts)
```

**Key design decision:** `Policy.derived_from` ties every tier's policy object back to one `LicenseAgreement`, so a feature can never be "on" for billing/provisioning purposes without also being on for the consent/disclosure screen the monitored person sees — this is the technical enforcement of the principle already stated in licensing-billing-spec.md §6.

For how to actually test this stack — backend via Podman on a Mac dev host, plus all 4 agent platforms via emulator/simulator/VM — see [testing-strategy-spec.md](./testing-strategy-spec.md).

## 3.1 Offline-First Requirement (cross-cutting)

Every agent must enforce policy and capture data with **zero connectivity**, queueing locally and syncing automatically once online — the Admin Console only ever reflects synced state, never a live device connection. This adds a local embedded-DB layer (policy cache, consent-flag cache, durable outgoing event queue) to every agent, and a sync protocol (staleness check, idempotent batched upload, timestamp-authoritative ingestion) on the backend side. Full analysis — including the honest list of features that inherently require connectivity (remote lock/wipe/lost-mode/policy-push, since those are server-initiated commands by definition) — is in [offline-sync-spec.md](./offline-sync-spec.md). The component map and data flow below assume this local-first behavior throughout.

## 4. Data Flow (end to end, one concrete example)

**Example: a child's screen-time limit is hit on a Windows device.**

1. Agent (Windows, via Family Safety integration) detects the limit locally and triggers the native OS lock — enforcement is **local-first**, not dependent on a round-trip to the backend (per family-tier-spec.md, lockout must work even if the device is briefly offline).
2. Agent emits a `UsageEvent` (end_ts marking session end) and an `AlertEvent` (type: `screen_time_limit_hit`) over HTTPS to the Event Ingestion Service.
3. Ingestion Service validates the event against the device's current `ConsentRecord.feature_flags_snapshot` (F1 must be enabled) — rejects if not, logs a mismatch alert for investigation (should never happen in correct operation, but this is the safety check).
4. Valid event → Event Stream → two consumers:
   - **Analytics Store** (for the parent dashboard's "today's usage" view)
   - **Notification Service** (pushes the alert to the parent's companion app via FCM/APNs/WNS)
5. Metering & Billing Service separately consumes the same stream to increment the relevant `UsageMeterEvent` (meter: `device-day` for F1) against the family's `LicenseAgreement` allowance.
6. Parent dashboard (Admin Console) queries Analytics Store + Policy Service on load — no direct agent-to-dashboard connection; everything flows through the backend.

This same pattern (local-first enforcement → event emission → stream → fan-out to analytics/billing/notification) applies to every other feature in feature-list.md; only the event type and which consumers care about it change.

## 5. Event Stream Choice & Rationale

- High-volume telemetry (location pings, usage events, compliance checks) should **not** write directly to the primary relational database — at scale (many devices × many meters × continuous polling) this would overwhelm transactional storage meant for `LicenseAgreement`/billing integrity.
- A durable queue/stream (e.g. Kafka, or a managed equivalent like AWS Kinesis/Google Pub/Sub) sits between ingestion and storage, allowing:
  - Billing and analytics to consume independently, at their own pace, without blocking ingestion.
  - Replay (reprocess historical events if a metering bug is found and invoices need correction).
  - Backpressure handling (a burst of location pings doesn't take down the API).

## 6. Technology Stack (proposed, open to revision)

| Layer | Dev environment | Production | Rationale |
|---|---|---|---|
| **Backend services** | Local containers (Docker Compose) | Kubernetes (or managed container service) | Multiple independently-deployable services (§2) benefit from container orchestration; Docker Compose keeps local dev simple without needing a full cluster |
| **Backend language/framework** | Same as prod | Node.js/TypeScript (NestJS) or Go, team-dependent — TypeScript recommended if the Admin Console frontend is also TypeScript/React, for shared types across the `LicenseAgreement`/`Policy` schema | Shared type definitions between frontend and backend reduce the exact kind of data-model drift seen across the tier specs' independent "first pass" models |
| **Primary database** | Postgres (local container) | Managed Postgres (e.g. RDS/Cloud SQL) | Relational integrity needed for `LicenseAgreement`, `Device`, `ConsentRecord`, billing — this data must never be eventually-consistent |
| **Event stream** | Local Kafka (or Redpanda, lighter for dev) container | Managed Kafka (MSK/Confluent Cloud) or Pub/Sub | Durable, replayable, decouples ingestion from billing/analytics |
| **Analytics/event store** | Local Postgres or DuckDB for small-scale dev testing | Columnar store (ClickHouse, BigQuery, or Timescale) | Usage/location events are high-volume, read-heavy for dashboards — a columnar/time-series store outperforms relational for this access pattern |
| **Admin Console frontend** | Vite/React dev server | Static build served via CDN + API backend | Standard SPA deployment; dashboards are data-heavy but not real-time-critical beyond the alerts feed |
| **Mobile/desktop agents** | Platform-native dev tooling (Xcode, Android Studio, Visual Studio) | Signed, distributed per av-edr-compliance-spec.md §2 | No cross-platform framework substitute for the OS-native APIs this product depends on (Family Controls, Screen Time, MDM protocols) — native per platform is a requirement, not a choice |
| **Push/notification transport** | Platform sandboxes (APNs sandbox, FCM test) | APNs, FCM, WNS (native per platform) | Required for MDM Command Service too — see av-edr-compliance-spec.md §5 on avoiding custom beaconing protocols |
| **Auth** | Local JWT/dev IdP | Managed auth provider (e.g. Auth0/Cognito) or self-hosted, with SSO/SAML support for Employer tier | Employer tier needs SSO (per employer-tier-spec.md §8 open question); build on a provider that supports it from day one rather than retrofitting |
| **CI/CD** | GitHub Actions (or equivalent) running per-platform build+sign+scan | Same pipeline, gated environments (staging → prod) | Code-signing and VirusTotal scanning (av-edr-compliance-spec.md §6) must be CI steps, not manual, from Phase 0 |

## 7. Environments

| Environment | Purpose | Notes |
|---|---|---|
| **Local dev** | Individual developer machines | Docker Compose stack (Postgres, Kafka/Redpanda, backend services); agents run against a local backend URL, using platform sandboxes (TestFlight-equivalent, Android debug builds) — never testing against production consent/billing data |
| **Staging** | Pre-release validation, matches MVP phase scope | Mirrors production topology at smaller scale; this is where AV/VirusTotal scanning and SmartScreen reputation checks (av-edr-compliance-spec.md §3, §6) run before any pilot build goes out |
| **Production** | Live customer data | Full topology per §2/§6; strict audit logging (`AuditLogEntry`) on every access to monitored-person data, per the compliance principles in product-spec.md §9 |

## 8. Security & Compliance Hooks (architecture-level, ties back to other specs)

- All agent↔backend traffic over TLS with certificate pinning on the agent side where platform-feasible.
- Event Ingestion Service's consent-flag validation (§4 step 3) is the **architectural enforcement** of "can't collect what wasn't disclosed" — not just a policy statement.
- `AuditLogEntry` written for every: policy change, data export, remote MDM action, consent acceptance, and billing/license change — satisfies the audit requirements already named in employer-tier-spec.md and fleet-tier-spec.md.
- Data retention/auto-purge (product-spec.md §9) implemented as scheduled jobs against the Analytics Store and Event Stream retention policy, not manual deletion.

## 9. Open Questions
- Node/TypeScript vs. Go for backend — depends on team's existing expertise; either is viable, this doc doesn't need to force the decision yet.
- Self-hosted Kafka vs. managed (cost/ops tradeoff) — revisit once Phase 1 traffic volume is estimated.
- Does the Admin Console need a native mobile companion app (product-spec.md §3 mentions one) as part of this architecture, or is a responsive web app sufficient for MVP (Phase 1)? Recommend deferring native companion app to post-Phase-2.
- Multi-region deployment requirement, given GDPR-style data residency considerations already flagged in product-spec.md §9 — single-region for MVP, revisit at Phase 4 (Employer tier, which is more likely to have EU customers).
