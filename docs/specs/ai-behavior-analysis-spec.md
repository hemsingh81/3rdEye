# 3rdEye — AI-Assisted Behavior Analysis (Draft v0.1)

Scope: using a model (not a static blocklist) to classify **risk**, in two narrow places — a web request/page (upgrades F2) and an installed app's behavior signals (extends M5/the av-edr-compliance-spec.md idea of "network egress patterns resembling C2 beaconing," now applied defensively, in favor of the family/org instead of against it). This is an enhancement to existing enforcement mechanisms, **not a new kind of surveillance** — every non-negotiable constraint in [product-spec.md](./product-spec.md) §2 still applies in full. If anything here is read as a way around those constraints, that reading is wrong and the spec needs fixing, not the product.

## 1. What This Actually Is (and Isn't)

**Is:**
- A classifier that looks at a web request/page's own signals (URL structure, domain reputation/age, page content *category*) and outputs a risk category + confidence — the same job F2's static blocklist already does, done better against content a static list hasn't caught yet (freshly-registered phishing domains, typo-squatted lookalikes, a harmful site that doesn't fit a clean category).
- A classifier that looks at an installed app's **behavior metadata** (permissions requested, network destinations, background egress pattern) against known malicious/spyware signatures — a safety net alongside F3's allowlist, for the case the allowlist hasn't seen a brand-new malicious app yet.

**Is explicitly not, and will never become (ties to feature-list.md §5 Explicitly Excluded):**
- Profiling or scoring the **person's** behavior, mood, or intent. The model classifies a *URL* or an *app's technical behavior* — never "is this child depressed," "is this employee a flight risk," or any inference about the person themselves. If a future request asks for that, it's a different, rejected product, not an extension of this one.
- Reading or retaining message content, page content snapshots, or browsing history beyond what F2/F6 already disclose (category + domain, not full history). The classifier sees request/page **metadata**, not a permanent transcript of what was read.
- A silent decision. Every block this produces is as visible as a static-blocklist block already is — see §4.

## 2. Content/Request Risk Classification (upgrades F2)

- Runs **on-device**, against a lightweight local model — not a round-trip to a cloud API per request, for the same reason F2's static filtering is on-device today: a request-by-request cloud call would be slow, would leak every URL a person visits to a third party, and would stop working offline, which breaks the Phase 1 offline-first requirement.
- Output is a risk category (phishing, newly-registered/suspicious domain, lookalike/typosquat, uncategorized-but-high-risk-signal) plus a confidence score. Below a configurable confidence threshold, nothing happens — a low-confidence guess never blocks silently; it's logged for the periodic retraining/review process in §5, not acted on.
- Sits **alongside** the static category blocklist, not replacing it — the blocklist's exact-match categories (adult/violence/gambling) stay deterministic and auditable; the model only covers what a static list structurally can't (content nobody has categorized yet).

## 3. App Behavior Risk Classification (extends M5 / F3's safety net)

- Looks at the same `InstalledAppEvent` metadata system-architecture-spec.md §3 already defines (install source, permissions, is_approved) plus the network-egress-pattern signal av-edr-compliance-spec.md §5 already names for the agent's *own* traffic — applied here to classify *other* installed apps on the device, not the agent itself.
- A flagged app surfaces as an `AlertEvent` on the parent/IT dashboard — "this app's behavior looks like known spyware/malware patterns" — with a one-click path into F3's existing block/uninstall action (feature-list.md F3, family-tier-spec.md §2 item 2). This reuses F3's mechanism; it does not invent a second blocking pathway.
- This capability is inherently best-effort and probabilistic — it will have false positives and false negatives, same as any AV engine. It's a safety net on top of F3's default-deny allowlist, not a replacement for it.

## 4. Transparency Requirement (non-negotiable, ties to X2)

- An AI-driven block or flag shows up on the monitored person's own disclosure screen (F6/E6) **identically** to a rule-based one — same visual treatment, same "why" explanation in plain language ("this site looked like a phishing attempt" / "this app's behavior matched a known spyware pattern"), never a vaguer or more clinical message than the static-blocklist case gets.
- The disclosure screen's existing "ask your parent/admin if you think this is wrong" pattern (already in the Child transparency mockup) applies here too, and matters more here — a probabilistic classifier is more likely to be wrong than an exact-match blocklist, so the appeal path isn't optional polish, it's load-bearing.
- No feature in this doc may ship without its block/flag reaching the same disclosure screen the static-blocklist equivalent already reaches. This is the one hard rule of this spec, the same way dev-standalone-mode-spec.md has its own one hard rule.

## 5. Data & Model Notes

- Training/update data is request *metadata* and app behavior *metadata*, aggregated and anonymized — never a specific family's/org's raw browsing content used to retrain a model served to other customers, which would itself be a privacy breach regardless of intent.
- Model updates ship like a blocklist update (versioned, pushed to the local cache, same sync mechanism offline-sync-spec.md §4 already describes) — not a live cloud classification call per request (§2).
- Low-confidence flags accumulate for periodic human review (a short list an engineer checks before a model update ships), not for per-request human-in-the-loop blocking — that would defeat the point of real-time local enforcement.

## 6. Compliance Note — Automated Decision-Making

Blocking a request or flagging an app based on a model's output is **automated decision-making** in the sense GDPR Article 22 and similar regimes use the term, and this matters most for Employer tier (per employer-tier-spec.md §6's existing jurisdiction-notice requirements) — an employee has a stronger legal interest in knowing a decision affecting their work device was automated than a child does. §4's transparency requirement is necessary here but may not be sufficient on its own; this needs the same legal review pass employer-tier-spec.md already flags for jurisdiction-specific consent, before this ships for Employer tier specifically.

## 7. Where This Fits in Build Sequencing

**Not part of Phase 1.** F1/F2's MVP slice (mvp-build-plan.md §3) ships with the static category blocklist only — no model, no classifier, nothing in this doc. This is a Phase 2+ enhancement to F2, and a post-Phase-4 enhancement to F3/M5 (those tiers aren't even built yet). Recommend revisiting this doc's priority once Phase 2 is underway and there's real data on how often the static blocklist actually misses something a model would have caught — building a classification pipeline speculatively, before that evidence exists, would be the same mistake the ponytail review already flagged elsewhere in this spec set (docs/specs/mvp-build-plan.md's own sequencing principle #3 applies here too: prove the simpler mechanism first).

## 8. Open Questions

- Build a small on-device model in-house, or license an existing mobile-friendly content-classification model/SDK (faster to ship, but adds a vendor dependency and a due-diligence pass on what *that* vendor does with request data)?
- What confidence threshold is conservative enough to avoid "the AI blocked my homework site" support tickets, without being so conservative the feature never actually catches anything a human wouldn't have caught via the static list anyway?
- Does the app-behavior classifier in §3 need its own opt-in/opt-out toggle distinct from F3's allowlist toggle, given it's explicitly probabilistic and heavier-weight than F3's deterministic default-deny?
