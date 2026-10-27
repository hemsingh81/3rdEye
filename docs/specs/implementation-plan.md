# 3rdEye — Implementation Plan (Draft v0.1)

Scope: translates the spec set into an ordered, concrete task list — what to actually build next, in what order, with acceptance criteria. Mirrors [mvp-build-plan.md](./mvp-build-plan.md)'s phases, but at engineering-task granularity, and grounded in what's **actually in this repo today**, not what was originally proposed. Where reality has already diverged from an earlier spec, §1 says so explicitly rather than pretending it didn't.

For §1's tasks broken into individually pick-up-able stories — each run through the full analyze/split/code/test/review workflow — see [development-stories.md](./development-stories.md). This doc stays the record of *why* each task exists; that one is the backlog to actually work from.

## 0. What's Already Built (don't redo this)

**Phase 1 is complete** (development-stories.md STORY-01 through STORY-08):

| Area | What exists | Where |
|---|---|---|
| Backend | Express + Postgres, single process (not the microservices split system-architecture-spec.md §2 originally proposed — see §1.0 below) | `backend/` |
| Data model | `families`, `devices`, `consent_records` (001), `policies` + threshold column (002, 004), `usage_events`/`alert_events` (003), `users` (005) | `backend/migrations/` |
| API | Auth (register via `POST /api/families`, `POST /api/auth/login`, JWT Bearer), enroll, consent lookup/accept, device list (family-scoped), policy get/set (ownership-checked), event batch ingest (idempotent), alerts feed read | `backend/src/routes/` |
| Robustness | Every route wrapped in `asyncHandler`; a bad request returns 400 instead of crashing the process (confirmed crashing live, then fixed) | `backend/src/asyncHandler.ts`, `backend/src/server.ts` |
| Stale-device sweep | Scheduled job (X9), flags once per threshold-crossing, clears on real resync | `backend/src/staleDeviceSweep.ts` |
| Self-check | 30 assertions: enroll → consent → policy versioning → events/idempotency → stale-device → auth negative-paths → alerts | `backend/src/test.ts` |
| Admin console | Real app: register/login, device list with `needs_attention`, add-device + enrollment code, policy editor, alerts feed | `backend/src/public/index.html` |
| CI | Postgres service container, migrate, start, readiness-probe, run self-check, on every push | `.github/workflows/backend-ci.yml` |
| Windows agent | Tray icon, enrollment screen, consent form, F1 lockout (daily-reset bug fixed), F2 local DNS filtering + DoH-disable mitigation, durable event queue (race-condition fixed, thread-safe), dev-standalone config (`#if DEBUG`-gated) | `agents/windows/` |
| Android agent | Full scaffold per android-agent-spec.md — **never compiled or syntax-checked, no SDK in this environment** | `agents/android/` |
| Prototypes | Feature map, 4-role dashboard mockup, public marketing site — all static, none wired to the real backend | `prototype/` |
| Specs | 18+ documents, all cross-linked, link-checked | `docs/specs/` |

**Not built at all yet:** iOS/macOS anything, F3/F4/F7 (app control enforcement, geofencing, multi-child — see development-stories.md's Phase 2 section), custom content filter lists, jurisdiction-gating, any code-signing/VirusTotal step (CI only runs the self-check so far), anything from Phase 3–5.

### 0.1 Architecture decision this plan is recording (not proposing)

system-architecture-spec.md §2 originally specced ten separate services (API Gateway, Auth, Policy & Consent, Event Ingestion, Metering & Billing, Notification, MDM Command, Licensing & Checkout, Admin Console, Audit) and testing-strategy-spec.md §2's `podman-compose.yml` sketch reflected that split. What actually got built for Phase 0/1 is **one Express process** with route modules. This is the right call for this stage — mvp-build-plan.md §1's own sequencing principle #1 ("prove the smallest real slice first") argues against splitting into ten deployable services before there's a single real user — but it's a divergence from what two other specs describe, so: **the service split is deferred until a concrete scaling or team-ownership reason forces it, not before.** testing-strategy-spec.md §2's compose file should be treated as the future-state target, not today's dev setup; today's dev setup is `backend/podman-compose.yml` (Postgres only).

## 1. Phase 1 Completion — Remaining Tasks

Ordered by dependency, not by importance — several of these can run in parallel once the ones they depend on land.

### 1.1 Local event queue + sync protocol (offline-sync-spec.md §3–4)
**Why first:** almost everything else below (usage summary, alerts feed, stale-device detection) needs events actually flowing before it can be real instead of mocked.
- Backend: `usage_events`, `alert_events` tables (device_id, type/app_id, payload, client_event_id for idempotency, ts, ingested_at) + `POST /api/devices/:id/events` (batch ingest, idempotent on `client_event_id`) + update `last_synced_at` on successful ingest.
- Windows agent: a local SQLite (or append-only JSON Lines, smallest-complete-thing for this slice) event queue; `LockoutEnforcer` emits a `UsageEvent`/`AlertEvent` on lock; a sync loop flushes the queue on the existing 5-minute timer, alongside the policy pull.
- **Acceptance:** lock the test device, kill connectivity, restore it, confirm the event appears server-side with the original (not re-sync) timestamp.

### 1.2 Windows enrollment UI
**Why:** `agents/windows/Program.cs` currently assumes `config.json` already exists — there's no screen for a parent to actually enter the enrollment code generated by `POST /api/devices`.
- A small WinForms screen, shown when `LocalConfig.Load()` returns null: enter backend URL + enrollment code → calls `GET /api/devices/by-code/:code` → on success, writes `LocalConfig` (device_id resolved from the lookup) → proceeds into the existing `ConsentForm` flow.
- **Acceptance:** a freshly-installed agent with no config file can be enrolled end to end using a code generated from the dashboard, with no manual file editing.

### 1.3 Stale-device sweep (X9, offline-sync-spec.md §5)
**Why:** specced and threaded through the dashboards, never actually built — right now `last_synced_at` just sits there with nothing watching it.
- A scheduled job (simplest form: a `setInterval` in the same process is fine for this stage — a separate cron service is exactly the kind of premature split §0.1 just argued against) comparing every device's `last_synced_at` against `policies.stale_device_alert_threshold_hours` (add this column; default 24), setting a `needs_attention` flag and firing one `AlertEvent` per threshold-crossing.
- **Acceptance:** manually backdate a test device's `last_synced_at` past the threshold, confirm the sweep flags it exactly once, not repeatedly.

### 1.4 Admin Console auth (JWT, system-architecture-spec.md §2.1) — do this *before* or *alongside* the real console, not after
**Why now, not later:** the backend currently has zero auth — `GET /api/devices?family_id=` will return any family's data to anyone who knows the UUID. This isn't a nice-to-have bolted onto the dashboard; it's a live data-exposure gap in what's already running.
- `POST /api/auth/login`, JWT issuance (1h expiry, no refresh flow yet), `httpOnly` cookie, and a middleware that rejects any `/api/families`, `/api/devices`, or policy-route request without a valid token — then scopes every query to the token's `family_id`/`org_id` claim, per system-architecture-spec.md §2.1.
- **Acceptance:** a request with no token, an expired token, or a token for a *different* family all get rejected; a valid token only ever sees that family's own data — write a test for each of those three cases, not just the happy path (the self-check pattern `backend/src/test.ts` already established).

### 1.5 Real admin console (replaces the static `index.html`)
- Minimal server-rendered or lightweight SPA (pick one stack and move on — system-architecture-spec.md §6 left this genuinely open, don't relitigate it here): a login screen (against 1.4), device list wired to `GET /api/devices` (showing the new `needs_attention` status from 1.3), a policy editor wired to `GET`/`PUT /api/devices/:id/policy`, an alerts feed wired to the event table from 1.1.
- **Acceptance:** the Parent-dashboard prototype's layout (`prototype/dashboards.html`) is the visual target — this task is "make that mockup real," not "design a new one."

### 1.6 F2 enforcement (content filtering — currently policy-only, not enforced)

**Decision (spike done, recorded here — not an unstated assumption):** ship **local DNS-based filtering** for Phase 1, not a TLS-intercepting proxy and not a WFP kernel driver. Reasoning:

- **Ruled out: a local proxy with TLS interception.** This is what some competitors actually do (install a root CA, MITM HTTPS to read the URL), but it directly contradicts this product's own trust pitch — the marketing site (prototype/website.html) explicitly promises "we never read your browsing content," and installing a root CA to decrypt traffic is itself exactly the kind of invasive-looking behavior av-edr-compliance-spec.md §5 warns gets flagged. Wrong tool even where it's technically easiest.
- **Ruled out, for now: a WFP callout driver inspecting TLS ClientHello SNI.** This is the *architecturally* right answer — domain-level blocking without decrypting anything, matching F2's actual scope (category + domain, never full URL, per feature-list.md F2) — but a signed kernel driver is a real certification/signing lift (av-edr-compliance-spec.md §2) disproportionate to an MVP beta timeline. This is the documented upgrade path, not an abandoned idea: revisit in Phase 2 alongside the custom-filter-list work, once there's a real reason (the DNS approach's gap below actually biting real users) to justify it.
- **Chosen for Phase 1: a local DNS proxy/resolver** the agent runs, matching cached `content_filter_categories` by domain and refusing resolution for a blocked domain. No driver, no cert, ships inside the Phase 1 timeline, and it's the exact granularity F2 already promises (domain-level, not URL-level).
- **Known, disclosed gap (same honesty pattern as family-tier-spec.md §2.1's non-Store-app gap):** a browser using encrypted DNS (DNS-over-HTTPS, on by default in current Chrome/Edge/Firefox) bypasses a local DNS filter entirely. Mitigation that ships *with* this, not later: push the registry policies Chrome/Edge/Firefox already support to disable DoH fallback on a managed device (`DnsOverHttpsMode` et al.) as part of enrollment — this closes the gap for the browsers that matter today without needing the driver. Document this mitigation in the child/parent-facing help content rather than silently relying on it always working, the same way the non-Store-app gap is disclosed rather than hidden.
- **Acceptance:** a site in the cached `content_filter_categories` list fails to resolve on the test device; the block is visible on both the parent dashboard's block log and (once built) the child's transparency screen; confirm the DoH-disabling registry policy is actually applied and verify the gap exists when it's deliberately removed (so the limitation is measured, not assumed).

### 1.7 Android agent (parallel track — can start once 1.1–1.2's backend contracts are stable)
- Full design in [android-agent-spec.md](./android-agent-spec.md) — same shape as the Windows agent, mapped onto Android's actual native mechanisms (Accessibility Service + overlay lock, not Device-Owner/MDM provisioning, which is Fleet-tier-heavy and wrong for a normal home setup).
- **Acceptance:** mirrors 1.1's acceptance criterion, on Android, in the Android Emulator per testing-strategy-spec.md §3.2.

### 1.8 Code signing + CI (av-edr-compliance-spec.md §2, §6)
- Not blocking for local dev/testing, but mvp-build-plan.md §1 principle #4 says this starts in parallel from day one, not bolted on before launch — it's listed here so it doesn't quietly slip to "later" indefinitely. Minimum for this phase: a CI pipeline that builds + runs `backend/src/test.ts` on every push, with signing/VirusTotal steps added once there's an actual installable artifact to sign.

## 2. Phase 2–5 — Task Groups (Phase 2 now expanded; 3-5 stay at pointer-level)

Phase 1 is complete, so Phase 2 earned its detailed breakdown — see development-stories.md's Phase 2 section (STORY-09 through STORY-16) for the full analyze/split/code/test/review/acceptance treatment. Phase 3–5 stay as pointers below; expanding them now, before Phase 2 is even underway, would be the same premature-depth mistake the earlier ponytail review already caught this spec set making once.

- **Phase 2** (family-tier-spec.md full parity, same 2 platforms): a real architecture correction first (`Policy` re-keyed from device to child — STORY-09, since Phase 1's schema diverged from system-architecture-spec.md §3's actual model), then F3 enforcement (STORY-10/11/12), F4 geofencing (STORY-13), F7 multi-child dashboard (STORY-14), custom content filter lists (STORY-15), and the jurisdiction-consent-gating mechanism (STORY-16, built once here, reused by Employer tier in Phase 4). The WFP/SNI upgrade to F2 named in §1.6 stays deferred past even Phase 2 — nothing in development-stories.md's Phase 2 section builds it yet, since the DNS approach's DoH gap hasn't been shown to actually cost real users anything.
- **Phase 3** (iOS + macOS): net-new platform work against Apple's Family Controls/Screen Time framework — notarization and App Review lead times mean this should start its signing/provisioning track well before the feature code is ready.
- **Phase 4** (Employer tier + metering goes live): this is where system-architecture-spec.md §2's service split starts to earn its keep for real — Metering & Billing is a genuinely separate concern by this point, unlike Phase 1. Also where ai-behavior-analysis-spec.md and pricing-model-spec.md actually get built, per their own "deferred past Phase 1" framing.
- **Phase 5** (Fleet/MDM): the MDM protocol integrations (DEP/Android Enterprise/Autopilot) are the long-lead-time item here — same lesson as Phase 3's Apple track, start that provisioning/enrollment-program paperwork early.

## 3. Immediate Next Steps (pick one, don't parallelize everything on day one)

Phase 1's §1.1–§1.8 are all complete. In order of how much they unblock within Phase 2:
1. **STORY-09 (ChildProfile + Policy re-keying)** — a real schema correction, not a feature; STORY-10, 13, and 14 all build on top of it.
2. **STORY-10 (F3 backend)** — unblocks STORY-11 and STORY-12.
3. **STORY-15 and STORY-16** can start any time — both are independent of STORY-09's schema work and of each other.

STORY-11/12 (per-platform F3 enforcement) and STORY-13/14 should wait on their dependencies rather than starting in parallel with everything else — the same lesson Phase 1 already demonstrated: STORY-09's schema change touches `policy.ts`/`devices.ts` broadly enough that building F3/F4/F7 against the pre-STORY-09 schema would just mean redoing that work once STORY-09 lands.
