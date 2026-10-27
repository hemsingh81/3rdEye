# 3rdEye — MVP Scope & Build Sequencing Plan (Draft v0.1)

Scope: decides what actually ships first, in what order, out of the full vision in [product-spec.md](./product-spec.md), the three tier specs, [feature-list.md](./feature-list.md) (24 features), and [licensing-billing-spec.md](./licensing-billing-spec.md). Everything specced so far is the target state; this doc is the path to it.

For the concrete, engineering-task-level breakdown of what to build next (grounded in what's actually in the repo today, not just the target state), see [implementation-plan.md](./implementation-plan.md) — or [development-stories.md](./development-stories.md) for that same work broken into pick-up-able stories, each run through the CLAUDE.md workflow.

## 1. Sequencing Principles

1. **One pillar, one platform pair, before going wide.** Building all 3 pillars × 4 platforms × full billing engine simultaneously is how specs rot. Prove the hardest part of the model (visible-agent + consent + real enforcement) on the smallest real slice first.
2. **Prove the no-covert-mode trust model before scaling features.** The differentiator is disclosure; if the consent flow and visible-agent indicator aren't solid in v0, nothing else matters.
3. **Billing starts flat, becomes metered.** Building the full usage-metering/invoicing engine from day one is premature — charge a flat beta price first, instrument metering events from day one anyway (so historical data exists), turn on dynamic billing once usage patterns are known.
4. **AV/code-signing workstream starts in parallel from day one**, not bolted on before launch — per [av-edr-compliance-spec.md](./av-edr-compliance-spec.md) §6, signing infrastructure needs to be in CI before the first pilot build, not retrofitted.

## 2. Phase 0 — Foundations (no user-facing feature yet)

See [system-architecture-spec.md](./system-architecture-spec.md) for the concrete services, unified data model, and tech stack this phase builds.

See [testing-strategy-spec.md](./testing-strategy-spec.md) for how each phase's exit criterion actually gets verified — Podman-based backend + per-platform emulator/simulator/VM testing, mapped to these same phases in its §7.

**Offline-first is a Phase 0 foundation item, not a later enhancement.** Per [offline-sync-spec.md](./offline-sync-spec.md), the local embedded DB (policy cache, consent-flag cache, durable event queue) and the sync protocol must exist before Phase 1's lockout demo, because local-first enforcement is what Phase 1's exit criterion actually depends on — "the device locks at the limit" has to work with the device offline, not just online.


- Backend skeleton: multi-tenant data model (`Family`/`Org`, `Device`, `ConsentRecord`, `Policy` — shared shapes across tiers per the tier specs).
- Code-signing cert acquisition (Windows EV/Trusted Signing, Apple Developer ID) wired into CI — blocks any pilot distribution per av-edr-compliance-spec.md.
- Consent flow backend: `ConsentRecord` creation, policy versioning, re-consent-on-change logic — this is shared infrastructure for all three tiers, build once.
- Agent-side local embedded DB + sync protocol (policy cache, consent-flag cache, durable event queue, staleness check, idempotent upload) per offline-sync-spec.md §3–4 — shared infrastructure across all agents/platforms, build once.
- Basic admin/parent web console shell (auth, device list with last-synced timestamp, empty dashboard) — no policy editor yet.

**Exit criterion:** a device can enroll, show a consent screen, record acceptance, and show up in a dashboard. Zero monitoring features live yet.

## 3. Phase 1 — MVP Slice: Family Tier, Android + Windows, Flat Pricing

**Why this slice:** Family tier has the lowest compliance complexity (vs. Employer's jurisdiction-notice requirements) and the clearest existing competitor benchmarks (Qustodio, Family Link, Microsoft Family Safety) to validate against. Android + Windows chosen over iOS/macOS first because Android (Family Link APIs) and Windows (Family Safety APIs) integration is faster to stand up than Apple's Family Controls framework + notarization + App Review cycle — iOS/macOS follow in Phase 3, not dropped.

Features in this slice (from feature-list.md):
- **F1** Screen time limits & schedules with real lockout (Android Family Link DPC; Windows Family Safety sign-out-at-limit)
- **F2** Content/web filtering (category blocklist only — custom lists deferred to Phase 2)
- **F6** Child "what my parent can see" dashboard
- Parent dashboard: device list, today's usage summary (minimal, from feature-list.md §F7 scope)

Explicitly deferred past this slice:
- F3 (app install approval), F4 (location/geofence), F5 (comms metadata), F7 (multi-child — single child/single device only in Phase 1)
- All Employer and Fleet tier features
- Dynamic/metered billing — Phase 1 ships at a **flat beta price per device**, while still emitting `UsageMeterEvent` records in the background so Phase 4's metering engine has real historical data on day one

**Exit criterion:** a parent can enroll one Android or Windows device, set a screen time limit, see it actually lock the device at the limit **with the device in airplane mode**, and see a live child-visible disclosure screen (served from the local queue, with a pending-sync indicator). This is the first real demo of the whole product's core promise — including that it doesn't depend on connectivity to enforce.

## 4. Phase 2 — Family Tier Completion (same 2 platforms)

- Add F3 (app install approval), F4 (location/geofence), F7 (multi-child/multi-device)
- Add custom content filter lists (beyond category blocklist)
- Parent dashboard: alerts feed, policy editor (per family-tier-spec.md §3.4)
- Jurisdiction-aware consent gating groundwork (even though Family has fewer mandatory-notice jurisdictions than Employer, build the mechanism now since Employer/Fleet reuse it)

**Exit criterion:** Family tier matches its full tier spec on Android + Windows.

## 5. Phase 3 — Platform Expansion: iOS + macOS (Family Tier)

- Apple Developer Program enrollment, Family Controls framework integration (iOS), Screen Time/Family Sharing integration (macOS)
- Notarization pipeline (macOS) and App Store review process (iOS) — these have longer lead times than Android/Windows, hence sequenced after the feature set is proven on the faster platforms
- Re-validate F1 lockout enforcement specifically — Apple's framework has different edge cases (Family Sharing account structure, under-13 Apple ID requirements, per family-tier-spec.md §7 open questions) than Android/Windows

**Exit criterion:** Family tier fully matches feature-list.md across all 4 platforms.

## 6. Phase 4 — Employer Tier + Usage-Based Billing Engine

Why bundled together: Employer tier is where usage-based billing actually matters most (screenshots, DLP scans, seats — see licensing-billing-spec.md §4 meter catalog), so this is the natural point to turn on real metering rather than building it speculatively in Phase 1.

- Employer tier features (E1–E8) on Windows + macOS first (primary desktop-productivity use case), then Android/iOS
- Metering engine goes live: `UsageMeterEvent` → `BillingPeriodInvoice` pipeline, using Phase 1–3's already-instrumented events as a dry-run dataset to validate pricing before real invoices go out
- License template system (licensing-billing-spec.md §3) and the customizable checkout flow — this is also when Family tier moves off flat beta pricing onto the same metered model, now that the engine is proven

**Exit criterion:** an employer can buy a custom feature set via the unified checkout, get metered billing, and a Family-tier customer from Phase 1 can migrate onto the same billing engine without a product discontinuity.

## 7. Phase 5 — Fleet/MDM Tier

Sequenced last because it's the most infrastructure-heavy (Apple Business Manager/DEP, Android Enterprise zero-touch, Windows Autopilot integration) and the least differentiated from existing MDM vendors — it's valuable as a bundling play (one license, one agent, one invoice across all three pillars) once the other two are proven, rather than a wedge to lead with.

- M1–M9 per fleet-tier-spec.md, all 4 platforms (MDM protocols are inherently cross-platform by nature of the enrollment programs)
- Cross-tier device dual-enrollment (fleet + employer on the same device, per fleet-tier-spec.md §6)

**Exit criterion:** full feature-list.md coverage across all three pillars and all four platforms, on the unified billing/license model.

## 8. Sequencing Summary Table

| Phase | Pillar | Platforms | Billing | Key exit criterion |
|---|---|---|---|---|
| 0 | — (foundations) | — | — | Enroll + consent + empty dashboard works |
| 1 | Family (MVP slice) | Android, Windows | Flat beta | Real lockout + child disclosure demoed |
| 2 | Family (complete) | Android, Windows | Flat beta | Full family-tier-spec.md parity on 2 platforms |
| 3 | Family (complete) | + iOS, macOS | Flat beta | Full family-tier-spec.md parity on 4 platforms |
| 4 | + Employer | Windows, macOS → Android, iOS | **Metered goes live** | Unified checkout + metered billing working end-to-end |
| 5 | + Fleet | All 4 | Metered | Full feature-list.md (24 features) on all 4 platforms |

## 9. Open Questions
- Is Android+Windows really the right Phase 1 pair, or does the target early-customer segment skew iOS (e.g. if most pilot families are iPhone households, starting there despite the longer Apple lead time might be worth it)?
- Should Phase 1's flat beta price be free (growth/data-gathering priority) or paid-but-flat (revenue signal priority)?
- Minimum pilot customer count/feedback loop needed before exiting Phase 1 into Phase 2?
- When does AI-assisted risk classification ([ai-behavior-analysis-spec.md](./ai-behavior-analysis-spec.md)) actually earn a phase slot? Not before there's real data on how often Phase 1-3's static blocklist/allowlist misses something — speculatively building a classification pipeline before that evidence exists repeats the mistake the ponytail review already flagged elsewhere in this spec set.
