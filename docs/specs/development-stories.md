# 3rdEye — Development Stories (Draft v0.1)

Scope: [implementation-plan.md](./implementation-plan.md)'s §1 and §2 tasks, converted into stories — each one run through the [CLAUDE.md](../../CLAUDE.md) workflow (Analyze → Split into tasks → Code → Test → Review → Document). This is the backlog to actually pick a ticket from; implementation-plan.md stays the record of *why* each one exists and what was decided. Only Phase 1 and Phase 2 are broken out this far, now that Phase 1 is complete — Phase 3–5 stay at implementation-plan.md §2's pointer-level, for the same reason that doc gives: writing this much detail before a phase starts is exactly the premature-depth mistake this spec set has already been caught making once.

**Phase 1 dependency order:** STORY-01 → (STORY-02, STORY-03, STORY-04 can start once STORY-01's contracts exist) → STORY-05 depends on STORY-03 + STORY-04 → STORY-06 and STORY-07 are independent of the others and of each other → STORY-08 is ongoing, not a one-time unlock. **Phase 1 status: all 8 stories complete** (backend/console/Windows agent feature-complete; Android agent scaffolded but unverified, no SDK available in this environment).

**Phase 2 dependency order:** STORY-09 first (ChildProfile + Policy re-keying — a real schema correction, not a feature) → STORY-10 → STORY-11 → STORY-12 (backend, then each platform's F3 enforcement) → STORY-13 and STORY-14 depend on STORY-09 → STORY-15 and STORY-16 are independent of everything else in this phase.

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

---

# Phase 2 — Family Tier Completion (mvp-build-plan.md §4)

Same 2 platforms (Android, Windows) as Phase 1 — this phase is breadth within Family tier, not new platforms. Exit criterion: Family tier matches its full tier spec on Android + Windows.

**Dependency order:** STORY-09 (ChildProfile + Policy re-keying) first — it's a real schema correction, not a feature, and STORY-10/13/14 all build on top of it. STORY-10 → STORY-11 → STORY-12 (backend, then each platform's enforcement). STORY-15 and STORY-16 are independent of everything else in this phase.

---

## STORY-09 — ChildProfile + re-key Policy to child, not device
**Maps to:** system-architecture-spec.md §3 (unified data model) · mvp-build-plan.md §4 (F7) · **Size:** M · **Depends on:** nothing — this corrects a divergence Phase 1 left behind, the same way implementation-plan.md §0.1 flagged the service-split divergence.

**Analyze**
- A real gap, not a style preference: Phase 1's `policies` table (migration 002) is `PRIMARY KEY (device_id)` — one device, one policy. system-architecture-spec.md §3 specs `Policy` keyed by `child_profile_id`. F7 (multi-child/multi-device) is exactly the feature that makes this divergence matter: a kid with a phone *and* a laptop should share one set of rules, set once, not two independently-drifting policies.
- Confirm what actually breaks: `PUT /api/devices/:id/policy` currently upserts per-device. Nothing today lets two devices share a policy row.

**Split into tasks**
1. Migration: `child_profiles` (id, family_id, name, age_band). `devices` gains `child_profile_id` (nullable at first, for backward migration), nullable-FK to `child_profiles`.
2. Migration: `policies.child_profile_id` replaces `policies.device_id` as the primary key; a view or join replaces every current `WHERE device_id = $1` policy lookup with `WHERE child_profile_id = (SELECT child_profile_id FROM devices WHERE id = $1)`.
3. Backend: `POST /api/families/:id/children` (create a child profile), `POST /api/devices` gains a required `child_profile_id` (replacing the bare `platform`-only enrollment — a device is enrolled *for* a child now, not just for a family).
4. Update `policy.ts`'s GET/PUT to resolve through the device → child_profile join, not `device_id` directly. Device-side agent calls (`GET /api/devices/:id/policy`) keep the same URL shape — the agent doesn't need to know child_profile_id exists, it just asks for "my policy" by device id, same as today.

**Code**
- This touches `backend/src/routes/policy.ts`, `backend/src/routes/devices.ts`, and adds `backend/src/routes/children.ts` — follow the existing `asyncHandler` + ownership-check pattern (STORY-04), not a new one.
- `backend/src/test.ts` needs real rework here, not just new assertions appended — every existing policy/events/alerts test currently assumes one device = one policy; update them to create a child profile first, same as STORY-04's rewrite did for the auth flow.

**Test**
- Two devices under the same child profile: set policy once, confirm both devices' `GET .../policy` return the same version and values.
- A device with no child profile assigned: confirm policy operations fail cleanly (400, not a crash) — this is a new invalid state that didn't exist before this story.

**Review**
- The exact bug class to check for: a leftover `WHERE device_id = $1` somewhere in policy.ts or events.ts that nobody updated — grep for every occurrence of `device_id` in those files before calling this done, not just the ones the task list named.

**Acceptance:** two devices belonging to the same child, enrolled separately, share one policy — editing it from either device's perspective (or the dashboard) changes both.

---

## STORY-10 — F3 app control: backend (inventory + allowlist actions)
**Maps to:** implementation-plan.md's deferred F3 work · feature-list.md F3 · system-architecture-spec.md §3 (`InstalledAppEvent`, `app_control_mode`, `app_allowlist[]`) · **Size:** M · **Depends on:** STORY-09 (policy is child-scoped now, app_allowlist lives on that same `Policy` row).

**Analyze**
- Re-read family-tier-spec.md §2.1's App control rows precisely — three separable capabilities (install gate, block-from-running, remote uninstall), each with a *different* platform-capability ceiling. Don't build one undifferentiated "block" action; the dashboard and the agent both need to know which of the three they're asking for.
- feature-list.md's correction (this session's earlier work, commit `207e5a7`): remote uninstall is **not available on any platform** without Fleet-tier MDM. This story does NOT build remote uninstall for Family tier — that would be building past what the platform honestly supports. It builds the install gate and block-from-running only.

**Split into tasks**
1. Migration: `policies.app_control_mode` (`default_deny` | `notify_only`, default `default_deny`), `policies.app_allowlist` (JSONB array of `{app_id, approved_at, approved_by}`).
2. Migration: `installed_app_events` (device_id, app_id, install_source, is_approved, detected_at) — the agent reports what it finds installed; the backend doesn't discover this on its own.
3. Backend: `POST /api/devices/:id/installed-apps` (agent reports inventory, device-channel, unauthenticated — same trust boundary as `events.ts`), `PUT /api/devices/:id/policy/apps` (parent approves/denies a specific `app_id`, authenticated + ownership-checked, same pattern as the main policy PUT).
4. Admin console: an "Installed apps" panel per device (the prototype's `dashboards.html` Parent tab already mocked this exact table — Approve/Block buttons — build against that, not a new design).

**Code**
- Reuse `alert_events` for "unapproved app detected" notifications — don't invent a second alert mechanism.

**Test**
- Agent reports an app not on the allowlist → confirm it shows as "awaiting approval" on the dashboard, not silently dropped.
- Parent approves it → confirm the agent's next policy pull includes it in `app_allowlist`.

**Review**
- Ownership check on `PUT /api/devices/:id/policy/apps`, same as STORY-04's policy-editor fix — a device id alone doesn't prove the caller's family owns it.

**Acceptance:** an app reported by the agent as installed-but-unapproved appears on the parent dashboard; approving it there is reflected in the next policy the agent pulls.

---

## STORY-11 — F3 app control: Windows enforcement
**Maps to:** family-tier-spec.md §2.1 (App control rows, Windows column) · **Size:** L · **Depends on:** STORY-10.

**Analyze**
- family-tier-spec.md §2.1 is explicit that Windows' install gate only covers Microsoft Store apps (Family Safety's own approval setting) — a sideloaded `.exe`/`.msi` installs outside that gate, a documented gap, not something this story closes. This story builds **inventory + block-from-running** for whatever's actually installed, Store or not; it does not pretend to close the install-gate gap.
- Decide the block mechanism the same way implementation-plan.md §1.6 decided the DNS-filter approach: research first, record the decision, then build. A real Windows app-block mechanism without Enterprise-edition AppLocker/WDAC (not available on Home/Pro) realistically means a background process watcher that terminates a blocked app's process when detected — this is the smallest-complete thing within what a non-Enterprise Windows install actually allows, same reasoning pattern as choosing DNS filtering over a WFP driver.

**Split into tasks**
1. `InstalledAppInventory.cs`: enumerate `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` (and the WOW6432Node equivalent for 32-bit apps) on a timer, diff against the last-reported list, POST new entries to STORY-10's inventory endpoint.
2. `AppBlockEnforcer.cs`: poll running processes (`System.Diagnostics.Process.GetProcesses()`), terminate (`Process.Kill()`) any process whose executable matches a blocked (not-on-allowlist) app, emit an `alert_events` entry via `EventQueue` (reuse, not a new queue) when it does.
3. Wire both into `Program.cs`'s existing timer pattern — inventory scan and block-enforcement don't need the same cadence as the 1-minute lockout tick; a slower poll (e.g. every 30s) is enough and cheaper.

**Code**
- `AppBlockEnforcer` needs the same daily-reset-bug-class review the lockout and DNS filter already got — but this one has no "daily" state at all (blocking is stateless: either a process is on the list or it isn't), so the actual risk here is different: killing a process the user is actively using *every single poll tick* if the kill doesn't actually stop it fast enough, which would look like a crash-loop to the user. Guard: after killing, don't re-attempt for N seconds even if the process respawns immediately, and surface that as its own alert ("app kept restarting after being blocked") rather than silently hammering it.

**Test**
- Compile-check only (`dotnet build`), same limitation every Windows agent story has had.

**Review**
- Confirm `Process.Kill()` is wrapped in a try/catch — killing a process you don't have permission to terminate (some system/elevated processes) throws, and an unhandled exception here would take down the whole agent, the exact `d040b88` bug class applied to a new mechanism.

**Acceptance:** an app not on the device's allowlist is detected within one poll cycle and terminated; the agent itself does not crash or infinite-loop if the kill fails or the app relaunches immediately.

---

## STORY-12 — F3 app control: Android enforcement
**Maps to:** android-agent-spec.md (extends it — F3 wasn't in that doc's original scope, which was F1/F2/consent only) · **Size:** M · **Depends on:** STORY-10, STORY-07 (the Android agent scaffold).

**Analyze**
- Android has no equivalent of Windows' process-kill for another app without Device Owner privileges (same provisioning-model constraint android-agent-spec.md §1 already explains for lockout). The honest mechanism here is the **same overlay pattern `LockedActivity` already uses** for screen-time lockout: when the Accessibility Service detects a blocked app in the foreground, show the lock overlay immediately, with a message naming the blocked app instead of a time-limit reason. This is "block from running" in the only sense a non-Device-Owner Android app can actually deliver it — the blocked app keeps running in the background, but the user can't interact with it, same honest limitation already written into family-tier-spec.md §2.1's Android row for this exact feature.
- Inventory: `PackageManager.getInstalledApplications()` is a disclosed, standard API — no permission walk needed beyond what's already granted.

**Split into tasks**
1. Extend `ThirdEyeAccessibilityService.kt`'s `onAccessibilityEvent` to also check the foreground app's package name against the cached policy's `app_allowlist`, not just the lockout clock.
2. Reuse `LockedActivity.kt` with a different `reason` string, not a second lock-screen Activity.
3. A one-time inventory report on service start, using `PackageManager`, POSTed via the same contract STORY-10 defines.

**Code**
- Same file-reuse discipline android-agent-spec.md §2 already established for this codebase — extend existing classes, don't fork a parallel "app block" path next to the existing lockout path when they're the same overlay mechanism underneath.

**Test**
- No SDK available in this environment — unverified, same caveat as STORY-07's entire scope. Name it in `agents/android/README.md`'s known-gaps list, don't let it quietly become a different, better-verified story than the rest of this agent.

**Review**
- Confirm the overlay's `reason` text is honest about what happened ("this app isn't approved yet" vs. implying it's been removed — it hasn't, it's just not usable) — a vague message here is the kind of small dishonesty this product's whole premise argues against.

**Acceptance:** mirrors STORY-11's acceptance criterion conceptually (a non-allowlisted app can't actually be used), via the overlay mechanism instead of a process kill — unverified pending real SDK access, same as the rest of this agent.

---

## STORY-13 — F4 location sharing + geofence alerts
**Maps to:** feature-list.md F4 · family-tier-spec.md §2.1 (Location row) · **Size:** M · **Depends on:** STORY-09 (geofence rules belong on the child-scoped `Policy`, not per-device).

**Analyze**
- offline-sync-spec.md §2 already classifies this as "Partial offline" — geofence entry/exit is detected on-device without connectivity, but the parent's alert is deferred until sync. This story builds exactly that split, not a simplified always-online version.
- family-tier-spec.md §2.1 flags that desktop (Windows) location accuracy varies by hardware and is often Wi-Fi/IP-based only — don't let the UI imply GPS-grade precision on a desktop.

**Split into tasks**
1. Migration: `location_events` (device_id, lat, lon, geofence_id_nullable, ts, client_event_id) — same idempotent-insert shape as `usage_events`/`alert_events`, reusing STORY-01's event-table pattern, not a new one.
2. Migration: `policies.geofence_rules` (JSONB array of `{name, lat, lon, radius_meters}`).
3. Backend: extend `POST /api/devices/:id/events` to accept `location_events` in the same batch, rather than a separate endpoint — it's the same sync call, same idempotency contract.
4. Windows: native Windows Location API (`Windows.Devices.Geolocation`), polled on a timer; on-device geofence-boundary check against the cached policy (entry/exit detected locally, queued as an `alert_events` entry via the existing `EventQueue`, not a new mechanism).
5. Android: `FusedLocationProviderClient` (standard, disclosed-permission API), same on-device geofence check logic ported, not redesigned, from Windows'.

**Code**
- The geofence math (point-in-circle against `radius_meters`) should be one small shared piece of logic, written once per platform in that platform's own language, not two independently-reasoned implementations that could silently disagree on edge cases (a point exactly on the boundary, for instance).

**Test**
- Backend: post a location event inside and outside a defined geofence, confirm the right boundary-crossing alert fires.
- Windows: compile-check only. Android: unverified, same caveat as every Android story.

**Review**
- Confirm location data isn't retained longer than product-spec.md §9's data-minimization principle implies — this is exactly the kind of sensitive data a retention policy matters most for; don't let this story ship without at least a stated (if not yet enforced) retention window, same honesty standard as every other gap in this backlog.

**Acceptance:** a simulated location update crossing a defined geofence boundary produces exactly one alert event, with the parent dashboard showing "arrived at [name]" using the same language family-tier-spec.md §1 names.

---

## STORY-14 — F7 multi-child / multi-device dashboard
**Maps to:** feature-list.md F7 · **Size:** S · **Depends on:** STORY-09 (the hard model work already happened there — this is the dashboard surface on top of it).

**Analyze**
- Confirm this really is the lighter story it looks like: STORY-09 already made `Policy` child-scoped and devices child-assigned. What's missing is purely the admin console's ability to show more than one child and switch between them — no new backend data model.

**Split into tasks**
1. Admin console: a child-switcher (the prototype never mocked this — Phase 1's UI assumed one device per family) above the existing device list, listing each `child_profiles` row.
2. Device list filters to the selected child's devices; "+ Add device" (STORY-05) now also requires picking which child the new device is for.
3. "+ Add child" action, wired to STORY-09's `POST /api/families/:id/children`.

**Code**
- Extends `backend/src/public/index.html` in place — this is UI wiring on an already-correct backend, not new backend work.

**Test**
- Two children, two devices each: confirm switching the selector shows only that child's devices and policy, never a mix.

**Review**
- Confirm `GET /api/devices` (STORY-04's family-scoped version) still returns *all* of a family's devices across children — the child-filtering happens client-side on an already-correctly-scoped list, not by changing what the backend returns per-child (that would need a second, narrower endpoint for no real benefit at this data volume).

**Acceptance:** a family with 2 children and 2 devices per child can switch between children on the dashboard and see/edit only that child's own policy and device list.

---

## STORY-15 — Custom content filter lists
**Maps to:** family-tier-spec.md §2 item 3 ("custom block/allow list") · **Size:** S · **Depends on:** nothing beyond what STORY-06 already built (extends `DnsFilter.cs`, doesn't replace it).

**Analyze**
- This extends implementation-plan.md §1.6's DNS-filter decision, it doesn't revisit it — custom domains are matched the same way the embedded category sample list already is; this story just makes that list parent-editable instead of hardcoded.

**Split into tasks**
1. Migration: `policies.custom_blocked_domains` (TEXT[], default empty), `policies.custom_allowed_domains` (TEXT[], default empty — an explicit allow always wins over a category match, for the case a category list over-blocks something a parent wants to permit).
2. Backend: extend the existing policy PUT/GET to accept/return these two fields — not a new endpoint.
3. `DnsFilter.cs`: check the custom allow-list first, then the custom block-list, then the embedded category map, in that order — allow overrides category, category is the fallback.
4. Admin console: add the two list fields to the existing policy editor panel.

**Test**
- A domain on the custom block list that isn't in any category: confirm it's blocked. A domain in a blocked category but also on the custom allow list: confirm it resolves (allow wins).

**Review**
- Confirm the precedence order (allow > custom-block > category) is actually what's implemented, not just what's intended — this is exactly the kind of three-way precedence logic that's easy to get backwards in the first pass.

**Acceptance:** custom allow/block lists both take effect, with an explicit allow overriding a category-level block for the same domain.

---

## STORY-16 — Jurisdiction-aware consent gating (groundwork)
**Maps to:** mvp-build-plan.md §4 ("build the mechanism now since Employer/Fleet reuse it") · employer-tier-spec.md §6 · **Size:** M · **Depends on:** nothing, independent of the rest of this phase.

**Analyze**
- This is explicitly groundwork — Family tier has few mandatory-notice jurisdictions compared to Employer (employer-tier-spec.md §6), so the mechanism matters more for later phases than for Family tier itself. Build the mechanism generically now, reusably, rather than Family-tier-specific logic that Employer tier (Phase 4) would have to redo.
- The ai-behavior-analysis-spec.md §6 compliance note already flagged that Employer tier's automated-decision-making needs exactly this kind of jurisdiction gate later — this story is what that note was pointing at.

**Split into tasks**
1. Migration: `families.jurisdiction` (e.g. ISO country/region code, nullable — not every jurisdiction has a mandatory-notice requirement, so null is a valid "no gate needed" state, not a missing-data error).
2. Backend: a small jurisdiction → required-notice-features lookup table (data, not code — a jurisdiction's requirements changing shouldn't need a deploy). For Family tier today, this can be nearly empty (most jurisdictions gate location/geofence for minors, per existing disclosure norms) — the mechanism's generality matters more than Family tier's own specific entries.
3. Enrollment/policy-change flow: before a gated feature (e.g. F4 location) can be enabled for a jurisdiction that requires it, the flow must show the jurisdiction-specific notice and record acceptance — reuses `ConsentRecord`, doesn't invent a parallel consent mechanism.

**Code**
- Keep this mechanism's API shape generic enough that Employer tier (Phase 4) can hang its own, larger jurisdiction table off the same lookup structure without a rewrite — that's the actual point of building it now.

**Test**
- A family in a gated jurisdiction attempting to enable a gated feature without the jurisdiction-notice acceptance on file: confirm the request is rejected, not silently allowed with the notice shown after the fact.

**Review**
- Confirm this doesn't become Family-tier-specific in its implementation even though Family tier is the only caller today — re-read employer-tier-spec.md §6 once more before finishing, specifically checking that nothing here assumes "parent/child" language where "admin/employee" would need the same mechanism later.

**Acceptance:** a gated feature cannot be enabled for a family in a jurisdiction requiring notice until that jurisdiction's specific notice has been shown and accepted, recorded the same way any other consent is recorded.
