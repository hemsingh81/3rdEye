# 3rdEye — Public Marketing / Purchase Website (Draft v0.1)

Scope: the public, unauthenticated website where a prospective buyer learns what 3rdEye is and buys it — distinct from the Admin Console ([system-architecture-spec.md](./system-architecture-spec.md) §2), which is the logged-in product. This doc covers **initial launch only**: what mvp-build-plan.md's Phase 1–2 actually ships (Family tier, Android + Windows, flat beta pricing). Employer/Fleet marketing pages are explicitly deferred — see §6.

## 1. Goals

1. Explain the product's one real differentiator — **disclosed, never-covert monitoring** — before anything else, since that's the actual reason to pick this over a stealth competitor or over doing nothing.
2. Get a parent from landing page to checkout with no confusion about what the product does and doesn't do.
3. Never oversell: every claim on this site must be something a feature actually does today, not a roadmap item presented as shipped (ties to product-spec.md §2's non-negotiable constraints — overselling here would be its own kind of deception).

## 2. Audience & Scope for Launch

**Launch audience: parents (Family tier) only.** Employer/Fleet buyers are not the launch audience — per mvp-build-plan.md, those tiers don't exist yet. The site should not advertise features that aren't buildable today.

## 3. Information Architecture (launch pages only)

| Page | Purpose |
|---|---|
| **Home** | Hero statement of the product + the disclosure differentiator, feature highlights, social proof placeholder, primary CTA to pricing/signup |
| **How it works** | The three things that actually matter to a parent: screen time lockout, content filtering, app control (per family-tier-spec.md §2) — shown as outcomes, not technical architecture |
| **Trust & Transparency** | The thing that sets this apart: what's collected, what's never collected, the always-visible agent, the child's own view — this page does more selling than the feature pages |
| **Pricing** | The Phase 1 flat beta price per device (per mvp-build-plan.md §3) — not the full metered-billing pricing-model-spec.md, which isn't live yet |
| **Checkout / Sign up** | Entry point into the real purchase journey (licensing-billing-spec.md §2) — this page hands off to the product, it doesn't duplicate the flow |
| **Legal** (Privacy Policy, Terms, Data Retention) | Required before taking any payment or collecting any personal data — not optional for launch |

Not in scope for launch (§6): Employer tier page, Fleet tier page, blog/resources, help center, multi-language.

## 4. Content Requirements per Section

- **Hero**: one sentence stating what it does, one sentence stating what it will never do (hidden/stealth mode) — the second sentence is not boilerplate, it's the actual sales pitch for this category.
- **Feature highlights**: pull directly from feature-list.md's Family rows (F1, F2, F3, F6) — never invent a feature description independently of the spec that defines it, to avoid the site drifting from what's actually built.
- **Trust & Transparency page**: must show the *exact* categories tracked and *exact* categories never tracked, matching family-tier-spec.md §3.2's consent-screen copy word-for-word where possible — the marketing claim and the in-product consent screen must say the same thing, or the product looks dishonest at the moment of truth.
- **Pricing page**: must state plainly that this is a flat beta price, not a permanent price — per mvp-build-plan.md §3, Phase 1 ships flat pricing before the metered engine goes live in Phase 4; don't let marketing imply a pricing model that hasn't been built.
- **Legal pages**: Privacy Policy must disclose exactly what's collected (reuses the same category list as Trust & Transparency), data retention periods, and the data-export/delete rights already specced in feature-list.md X4.

## 5. Design Principles

- **Design for trust, not for excitement.** This product's category (parental monitoring) carries real stigma from stealth competitors — calm, plain language and specific claims build more credibility than marketing-speak or urgency tactics.
- No dark patterns: no fake urgency/scarcity, no pre-checked upsells, no confirm-shaming on the "no thanks" paths — this would directly contradict the product's own "nothing hidden" positioning.
- Accessible by default: real semantic HTML, sufficient contrast, works at phone width — the same bar set in `artifact-design`'s craft guidance.
- One primary call to action per page (buy / sign up); everything else is secondary.

## 6. Explicitly Deferred Past Launch

- Employer tier and Fleet tier marketing pages — build these when mvp-build-plan.md Phase 4/5 actually starts, not before, per the same reasoning already applied to pricing-model-spec.md and the tier specs themselves.
- Full comparison-to-competitors page, blog/resources, multi-language localization, native mobile app download pages (beyond linking to the platform stores).
- Live chat / support widget — route to email support at launch.

## 7. Open Questions

- Domain and hosting — same infra as the Admin Console (system-architecture-spec.md §6), or a simpler static host (since this site has no auth, no live data)? Recommend a separate static site (CDN-hosted) decoupled from the Admin Console deploy, since it changes on a totally different cadence (marketing copy vs. product releases).
- Does Trust & Transparency need legal review before launch, given it's effectively a public compliance statement? Recommend yes, before Phase 1 ships publicly.
