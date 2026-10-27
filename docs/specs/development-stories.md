# 3rdEye — Development Stories (Draft v0.1)

Scope: [implementation-plan.md](./implementation-plan.md)'s §1 tasks, converted into stories — each one run through the [CLAUDE.md](../../CLAUDE.md) workflow (Analyze → Split into tasks → Code → Test → Review → Document). This is the backlog to actually pick a ticket from; implementation-plan.md stays the record of *why* each one exists and what was decided. Only Phase 1 is broken out this far — Phase 2–5 stay at implementation-plan.md §2's pointer-level, for the same reason that doc gives: writing this much detail before a phase starts is exactly the premature-depth mistake this spec set has already been caught making once.

**Dependency order:** STORY-01 → (STORY-02, STORY-03, STORY-04 can start once STORY-01's contracts exist) → STORY-05 depends on STORY-03 + STORY-04 → STORY-06 and STORY-07 are independent of the others and of each other → STORY-08 is ongoing, not a one-time unlock.

---

## STORY-01 — Local event queue + sync protocol
**Maps to:** implementation-plan.md §1.1 · offline-sync-spec.md §3–4 · **Size:** M · **Depends on:** nothing — start here.

**Analyze**
- Re-read offline-sync-spec.md §3 (local data layer) and §4 (sync protocol) — this story builds exactly that, not a simplified version of it.
- Confirm against implementation-plan.md §0: no event table exists yet; `devices.last_synced_at` exists but nothing writes to it except the consent endpoint.

**Split into tasks**
1. Backend migration: `usage_events` / `alert_events` tables — `device_id`, `type`/`app_id`, `payload`, `client_event_id` (idempotency key), `ts` (device-reported, authoritative), `ingested_at` (server-side, audit only).
2. Backend endpoint: `POST /api/devices/:id/events` — batch insert, `ON CONFLICT (client_event_id) DO NOTHING` for idempotency, updates `devices.last_synced_at` on success.
3. Windows agent: a local queue (SQLite or append-only JSON Lines — pick the smaller one and move on, per CLAUDE.md's "smallest complete change") that `LockoutEnforcer` writes a `UsageEvent`/`AlertEvent` to on every lock.
4. Windows agent: extend the existing 5-minute sync timer (`agents/windows/Program.cs`) to flush the queue after the policy pull, not as a second unrelated timer.

**Code**
- Backend first (it's the dependency for everything else in this phase) — follow the existing `asyncHandler`-wrapped route pattern, no new conventions.
- Agent second, against the now-real endpoint.

**Test**
- Extend `backend/src/test.ts`: post a batch of events, confirm idempotent re-post doesn't duplicate, confirm `last_synced_at` updates.
- Manual device test: lock the test device, kill connectivity (airplane mode), restore it, confirm the event lands server-side with its *original* timestamp, not the reconnect time.

**Review**
- Check: does a retried/duplicate flush actually no-op, or does it silently double-count? (This is the exact failure mode offline-sync-spec.md §4 step 3 calls out by name.)
- Check: did this introduce a new unhandled-rejection path? Every new route must go through `asyncHandler` (the `d040b88` bug class).

**Acceptance:** lock the test device, kill connectivity, restore it, confirm the event appears server-side with the original (not re-sync) timestamp — carried directly from implementation-plan.md §1.1.

---

## STORY-02 — Windows enrollment UI
**Maps to:** implementation-plan.md §1.2 · family-tier-spec.md §3.1–3.2 · **Size:** S · **Depends on:** nothing (can run parallel to STORY-01).

**Analyze**
- `agents/windows/Program.cs` currently assumes `config.json` already exists — read it to confirm exactly where the gap is (the `LocalConfig.Load() is null` branch just shows an error and exits).
- Re-read family-tier-spec.md §3.2 for what the screen must disclose and in what order (enrollment code entry happens *before* the existing `ConsentForm`, not after).

**Split into tasks**
1. A small WinForms screen: backend URL + enrollment code fields, "Enroll" button.
2. On submit: `GET /api/devices/by-code/:code` → on success, construct and `Save()` a `LocalConfig` with the resolved `device_id`.
3. On failure (unknown code, unreachable backend): a plain-language error, not a stack trace — same bar `ConsentForm.cs` already sets for its own failure case.
4. Wire this screen in *before* the existing consent-check branch in `Program.cs`, so the flow is enroll → consent → tray + enforcement, in that order.

**Code**
- Mirror `ConsentForm.cs`'s structure (it's the closest existing example of a small, single-purpose WinForms screen in this codebase) rather than inventing a different pattern.

**Test**
- Compile-check only (`dotnet build`) — this environment has no real Windows runtime, same limitation `agents/windows/README.md` already states. Don't claim it was run on a device when it wasn't.

**Review**
- Confirm the enrollment code is never logged or shown back on screen after a successful enroll (it's a one-time-use credential, not something to leave visible).

**Acceptance:** a freshly-installed agent with no config file can be enrolled end to end using a code generated from the dashboard, with no manual file editing — carried directly from implementation-plan.md §1.2.

---

## STORY-03 — Stale-device sweep (X9)
**Maps to:** implementation-plan.md §1.3 · offline-sync-spec.md §5 · feature-list.md X9 · **Size:** S · **Depends on:** STORY-01 (needs the event/alert plumbing to fire its `AlertEvent` into something real).

**Analyze**
- Re-read offline-sync-spec.md §5's exact wording — this is a *one-time* alert per threshold-crossing, not a recurring nag; get that right from the start rather than fixing a spam bug later (same bug *class* as the Windows lockout's original daily-reset bug, just on the backend this time).

**Split into tasks**
1. Migration: `policies.stale_device_alert_threshold_hours INTEGER DEFAULT 24`.
2. Migration: `devices.needs_attention BOOLEAN DEFAULT false`.
3. A scheduled sweep (a `setInterval` in the same Express process — per implementation-plan.md §0.1, a separate cron service is the premature split this repo already decided against) comparing `last_synced_at` against the threshold.
4. On crossing: set `needs_attention = true`, insert one `AlertEvent`. On the device syncing again: clear `needs_attention` back to `false` (this half is implied by offline-sync-spec.md §5 but worth stating explicitly here so it isn't missed).

**Code**
- Keep the sweep's interval configurable via an env var, not hardcoded, so the test below doesn't need a multi-hour wait.

**Test**
- Extend `backend/src/test.ts`: manually backdate a test device's `last_synced_at` past the threshold (direct SQL in the test, that's fine for a self-check), run the sweep function directly (don't wait for the real interval), assert exactly one `AlertEvent` was created on first crossing and zero more on a second sweep run before the device re-syncs.

**Review**
- Re-run the sweep twice in the test without the device re-syncing in between — confirm it does **not** fire a second alert. This is the one thing most likely to regress into spam if written carelessly.

**Acceptance:** manually backdate a test device's `last_synced_at` past the threshold, confirm the sweep flags it exactly once, not repeatedly — carried directly from implementation-plan.md §1.3.

---

## STORY-04 — Admin Console auth (JWT)
**Maps to:** implementation-plan.md §1.4 · system-architecture-spec.md §2.1 · **Size:** M · **Depends on:** nothing — this closes a live gap, start it alongside STORY-01–03, not after.

**Analyze**
- Confirm the gap is real before building the fix: `curl` the running dev backend's `GET /api/devices?family_id=<any-uuid>` with no credentials and see that it returns data. (It does — this was confirmed live in this repo's history.)
- Re-read system-architecture-spec.md §2.1 for the exact decision already made: JWT, 1h expiry, no refresh flow yet, `httpOnly` cookie, claims are `sub`/`family_id`-or-`org_id`/`role`/`exp`.

**Split into tasks**
1. `POST /api/auth/login` (email + a password field — Phase 1 doesn't need SSO, that's Employer-tier/Phase 4 per employer-tier-spec.md §8).
2. JWT issuance + verification middleware.
3. Apply the middleware to every route under `/api/families`, `/api/devices`, and the policy routes.
4. Scope every query in those routes to the token's `family_id` claim — not just "logged in," but "logged in **and** this is your own family's data." This second half is the part that actually closes the gap; a login screen alone does not.

**Code**
- Don't touch the device-side agent routes (`GET /api/devices/by-code/:code`, `POST /api/devices/:id/consent`, the policy-pull endpoint) — system-architecture-spec.md §2.1 is explicit that those are a different trust boundary, scoped by device identity, not a user JWT. Scoping that channel is separate, smaller work, not part of this story.

**Test**
- Extend `backend/src/test.ts` with three new cases, not just a happy-path login: no token → rejected; expired token → rejected; a *valid* token for a *different* family querying another family's device → rejected. All three were named explicitly in implementation-plan.md §1.4 — write all three, not just one.

**Review**
- The most likely way this story fails quietly: a route that checks the token exists but forgets to scope the query by `family_id`. Re-read every modified route specifically looking for a `WHERE` clause (or lack of one) that doesn't reference the token's claim.

**Acceptance:** a request with no token, an expired token, or a token for a different family all get rejected; a valid token only ever sees that family's own data — carried directly from implementation-plan.md §1.4.

---

## STORY-05 — Real admin console
**Maps to:** implementation-plan.md §1.5 · **Size:** L · **Depends on:** STORY-03 (needs `needs_attention` to show) and STORY-04 (needs a login to build against).

**Analyze**
- The visual target already exists — `prototype/dashboards.html`'s Parent tab (Overview/Policy editor/Billing/Alert settings sub-tabs). This story is "make that mockup real," not "design a new screen." Re-read it before writing any new layout.
- Pick a frontend approach once and record the choice here (don't leave it open the way system-architecture-spec.md §6 deliberately did at the spec level — a spec can leave it open, a story can't):

**Split into tasks**
1. Login screen against STORY-04's endpoint.
2. Device list: `GET /api/devices`, showing `needs_attention` (STORY-03) alongside the existing enrollment status.
3. Policy editor: `GET`/`PUT /api/devices/:id/policy`, matching the prototype's field set (daily limit, bedtime, content-filter categories).
4. Alerts feed: reads from STORY-01's event tables.
5. Billing/Invoices sub-tab from the prototype is **not** in scope here — licensing-billing-spec.md's metering engine is explicitly deferred to Phase 4; the prototype's billing tab is a mockup of a later phase, don't build against it now.

**Code**
- Reuse the prototype's actual markup/CSS where it fits rather than redrawing it from scratch — it was already reviewed and verified to render correctly.

**Test**
- No automated test framework exists for the frontend yet — at minimum, manually walk through enroll → set policy → see it reflected → trigger a stale-device alert → see it appear, once per sub-feature this story touches.

**Review**
- Confirm every write action (policy save) goes through STORY-04's auth middleware — a new frontend route is exactly the kind of thing that can accidentally bypass auth if it's wired to a path pattern the middleware doesn't match.

**Acceptance:** the Parent-dashboard prototype's layout is the visual target — carried directly from implementation-plan.md §1.5.

---

## STORY-06 — F2 enforcement (content filtering)
**Maps to:** implementation-plan.md §1.6 · **Size:** M · **Depends on:** nothing — independent track.

**Analyze**
- The decision is already made and recorded in implementation-plan.md §1.6 — **local DNS-based filtering**, not a TLS-intercepting proxy or a WFP driver. This story implements that decision; it does not re-open it. If someone's instinct while building this is "wait, shouldn't we just use a proxy," the answer is already written down — read it before relitigating.

**Split into tasks**
1. A local DNS proxy/resolver component in the Windows agent, matching `content_filter_categories` by domain.
2. On a matched domain: refuse resolution, emit a `ContentFilterBlockEvent` (reuses STORY-01's event queue — don't build a second queue).
3. The DoH-disabling mitigation: push the `DnsOverHttpsMode` (and equivalents for Edge/Firefox) registry policy as part of enrollment (ties into STORY-02's enrollment flow — this is a natural place to apply it, not a separate feature).
4. Parent/child-facing help copy disclosing the DoH gap, per the "disclose, don't hide" pattern already used for the non-Store-app gap elsewhere in these specs.

**Code**
- Keep the category-matching logic in one place shared with wherever else category strings are compared, rather than a second parallel implementation.

**Test**
- Add a block event to `backend/src/test.ts`'s event-posting assertions (reuses STORY-01's test infrastructure).
- Manual device test: confirm a domain in the blocklist fails to resolve; confirm the registry policy is actually applied (not just assumed); confirm the stated gap is real by deliberately removing the policy and confirming a DoH-using browser does bypass the filter (implementation-plan.md §1.6's acceptance criterion is explicit that this limitation should be *measured*, not assumed).

**Review**
- Confirm the block reaches both the parent dashboard's block log (STORY-05) and, eventually, the child's transparency screen — an AI- or rule-based block that doesn't reach the disclosure screen is the one hard rule ai-behavior-analysis-spec.md §4 names, and it applies to this simpler rule-based filter too, by the same logic.

**Acceptance:** carried directly from implementation-plan.md §1.6 (domain blocked, visible on both dashboards, DoH gap measured not assumed).

---

## STORY-07 — Android agent
**Maps to:** implementation-plan.md §1.7 · android-agent-spec.md (full doc) · **Size:** L · **Depends on:** STORY-01 and STORY-02's backend contracts being stable (the Android agent is a second client of the same API, not a reason to change it).

**Analyze**
- Read android-agent-spec.md in full before starting — it already corrects an earlier mistaken assumption (that Android's Family Link DPC was available to a third-party app) and specs the actual mechanism (Accessibility Service + `UsageStatsManager` + overlay). Building against the old assumption would reintroduce a bug this repo already found and fixed once.

**Split into tasks** (per android-agent-spec.md §2's file-by-file mapping)
1. `PolicyClient.kt` — same fetch/cache/fallback contract as the Windows `PolicyClient.cs`, against the same API.
2. `LockoutEnforcer.kt` — **must** carry over the daily-reset and per-trigger-guard logic from the Windows fix in `d040b88` from day one, not as a bug discovered later (android-agent-spec.md §3 names this explicitly).
3. `ConsentActivity.kt` — same disclosure copy as `ConsentForm.cs`, not independently reworded.
4. The Accessibility Service + foreground-service notification (Android's non-hideable-icon equivalent).
5. The `UsageStatsManager` permission-grant step, with its own disclosure copy (android-agent-spec.md §4 flags this as needing explicit handling, not an assumption it's silently available).

**Code**
- Follow android-agent-spec.md §2's table exactly for which Windows file maps to which Android file — it already made the "literal port vs. platform-idiomatic" call for each piece (e.g. `EncryptedSharedPreferences` instead of porting the JSON-file approach).

**Test**
- Android Emulator per testing-strategy-spec.md §3.2, mirroring STORY-01's acceptance criterion (lock, go offline, reconnect, confirm the event lands with its original timestamp).
- A real physical-device pass on at least one aggressive-battery-optimization OEM skin before calling this done — android-agent-spec.md §4 names this as a real emulator-coverage gap, not optional polish.

**Review**
- Specifically check for the daily-reset bug class — this is the single most likely thing to get re-introduced on a new platform, and it's named explicitly as a risk in android-agent-spec.md §3 for exactly that reason.

**Acceptance:** mirrors STORY-01's acceptance criterion, on Android, in the emulator — carried directly from implementation-plan.md §1.7.

---

## STORY-08 — Code signing + CI
**Maps to:** implementation-plan.md §1.8 · av-edr-compliance-spec.md §2, §6 · **Size:** M (ongoing, not a single checkbox) · **Depends on:** nothing; start in parallel with everything else, per mvp-build-plan.md §1 principle #4.

**Analyze**
- This is infrastructure, not a feature — re-read av-edr-compliance-spec.md §6's process checklist before building the pipeline, so CI enforces that checklist rather than a guessed-at subset of it.

**Split into tasks**
1. CI pipeline: build + run `backend/src/test.ts` on every push (the minimum that exists today has no CI at all — `backend/src/test.ts` only runs when a developer remembers to).
2. Once there's an installable Windows agent artifact: add the signing step (av-edr-compliance-spec.md §2) and a VirusTotal scan gate.
3. Once there's an installable Android artifact: the Play-signing equivalent.

**Code**
- N/A — this story is pipeline configuration, not application code.

**Test**
- The CI pipeline's own "test" is: does it actually fail when `backend/src/test.ts` fails? Verify this by deliberately breaking one assertion, confirming the pipeline goes red, then reverting.

**Review**
- Confirm the pipeline doesn't silently skip the test step on a failure elsewhere (a common CI misconfiguration — a build-failure that's swallowed instead of propagated).

**Acceptance:** a CI pipeline that builds + runs the backend self-check on every push — carried directly from implementation-plan.md §1.8's minimum bar for this phase.
