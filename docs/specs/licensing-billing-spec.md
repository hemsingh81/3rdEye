# 3rdEye — Unified Purchase Journey, Licensing & Usage-Based Billing (Draft v0.1)

> **Metering/billing engine (§3–§5) is deferred until [mvp-build-plan.md](./mvp-build-plan.md) Phase 4.** Phase 1–3 run on a flat beta price per device while still emitting `UsageMeterEvent` records for later use. The purchase-journey UX (§2) is the near-term target; the metered-pricing machinery is not — don't build the metering engine before Phase 4 starts.

Re-aligns [family-tier-spec.md](./family-tier-spec.md), [employer-tier-spec.md](./employer-tier-spec.md), and [fleet-tier-spec.md](./fleet-tier-spec.md) into **one purchase journey**: the buyer picks a license type and feature set at checkout, every feature meters usage, and price is computed dynamically from metered usage against a chosen (and editable) template. No tier is a separate product anymore — they're three **license templates** on one product.

**Wireframes:** a 6-screen mockup of this flow — Intent → Template Selection → Feature Customization (with live price) → License & Consent Config → Checkout → the on-device consent screen the monitored person actually sees — is at [claude.ai/artifact/E9v3yv9N456YUTJ4v21NiR](https://claude.ai/artifact/E9v3yv9N456YUTJ4v21NiR). Treat §2's step-by-step description below as the prose spec for those same six screens.

## 1. Core Model

- **One agent, one backend, one purchase flow.** "Family," "Employer," and "Fleet" stop being separate products and become **License Templates** — a named, pre-filled bundle of feature toggles + pricing rules that a buyer can accept as-is or customize.
- **Every feature has a meter.** Nothing is flat-rate by default. Screenshots taken, location pings, devices enrolled active-days, DLP alerts evaluated, MDM remote actions issued, dashboard seats active — each is a distinct meter with its own unit price.
- **Billing = flat device-day base fee + Σ(meter_quantity × unit_price) per billing period**, with optional caps/included-allowances per template so costs stay predictable, not just metered-and-unbounded. Device enrollment itself is a flat per-device base fee, not a usage meter, priced in the buyer's own currency (INR or USD) per [pricing-model-spec.md](./pricing-model-spec.md) §2–§3.1 — a device going offline per [offline-sync-spec.md](./offline-sync-spec.md) shouldn't look like "less billed usage".

## 2. Purchase Journey (single flow, replaces three separate onboardings)

### Step 1 — Intent
Buyer answers one question: "What are you managing?" → Family devices / Workforce devices / Company-owned fleet / Combination. This selects a **starting template**, not a locked path — all features remain togglable afterward.

### Step 2 — Template Selection
Show the matching predefined template(s) (see §3) as a starting point, each with:
- Included feature list (toggled on by default for that persona)
- Estimated monthly cost based on a sample usage profile ("~5 devices, typical use" slider)
- A visible "Customize" action — this is not an upsell dark pattern, it's the primary path, since the whole point is dynamic/usage-based selection.

### Step 3 — Feature Customization
Grid of every feature across all three pillars (location, screen time, screenshots, DLP alerts, MDM lock/wipe, compliance checks, dashboard seats, etc.), each with:
- On/off toggle
- Per-feature meter + unit price shown inline, in the buyer's own currency — ₹ for an India-billed buyer, $ otherwise (e.g. "Screenshots: ₹0.12/capture" or "Screenshots: $0.0016/capture"), per the geo-based currency model in [pricing-model-spec.md](./pricing-model-spec.md) §2
- Live running total that recalculates as toggles/sliders change
- Features can be mixed across pillars freely — e.g. a solo proprietor could buy "Fleet anti-theft" + "Employer DLP alerts" for the same 3 devices with no Family features at all.

### Step 4 — License & Consent Configuration
- Number of devices / seats, jurisdiction (drives mandatory-consent gating from the tier specs).
- Buyer picks or edits the **License Template** that will actually govern what the monitored users see on their consent screens — this is generated automatically from Step 3's toggles, not written by hand, so disclosure always matches what's actually billed/enabled.

### Step 5 — Checkout
- Shows: template name (custom or predefined), active meters, included allowances, overage rates, estimated first-month cost, billing cadence (monthly in arrears, since usage-based billing is inherently postpaid-accurate).
- Buyer accepts → `LicenseAgreement` created, `Policy` objects provisioned across tiers accordingly, enrollment flows from the three tier specs proceed unchanged (consent screens, OS enrollment, etc.) — this spec only changes *how the policy/feature set gets chosen and paid for*, not the on-device disclosure mechanics already defined.

### Step 6 — Ongoing Adjustment
- Buyer (Admin/Parent/IT Admin) can revisit Step 3's grid anytime from account settings — toggle features on/off, switch templates, adjust allowances. Changes apply going forward; mid-cycle changes prorate.

## 3. Predefined License Templates (editable starting points, not hard tiers)

| Template | Pillars pre-enabled | Target buyer | Notes |
|---|---|---|---|
| **Family Starter** | Screen time, content filter, location/geofence | Parents | Mirrors family-tier-spec defaults |
| **Family Plus** | + app-install approval, multi-child | Parents, larger families | |
| **Workforce Essentials** | Usage/productivity tracking, DLP metadata alerts | Small employers | Mirrors employer-tier-spec defaults, screenshots off |
| **Workforce Pro** | + opt-in screenshots, team rollup reporting | Mid-size employers | |
| **Fleet Basic** | MDM enrollment, compliance checks, remote lock/wipe | IT admins, company-owned devices | Mirrors fleet-tier-spec defaults |
| **Fleet + Anti-Theft Plus** | + lost-mode, frequent location polling | Field workforces, high device-loss risk | |
| **Custom** | Blank slate, every feature off by default | Anyone | Pure build-your-own from Step 3 |

Templates are **data, not code** — stored as a `LicenseTemplate` record (feature flags + default meter allowances), so new ones can be added by an internal admin without a release. A buyer customizing a predefined template forks it into their own `LicenseAgreement` without mutating the shared template.

## 4. Meter Catalog

| Feature | Meter unit | Pillar |
|---|---|---|
| Device enrollment | active-device-day (flat base fee, not metered usage — see §1) | All |
| Dashboard seat (Manager/Viewer/Parent login) | active-seat-day | All |
| Location ping | per ping | Family, Fleet |
| Screen-time policy evaluation | bundled into device-day base fee | Family |
| Content filter evaluation | per 1,000 requests filtered | Family |
| Screenshot capture | per capture | Employer |
| DLP alert evaluation | per 1,000 file-events scanned | Employer |
| MDM remote action (lock/wipe/locate/policy-push) | per action | Fleet |
| Compliance check run | bundled into device-day base fee | Fleet |
| Lost-mode active period | per day active | Fleet |

**Final unit prices, cost basis, included allowances/caps, and the geo-based currency model** are in [pricing-model-spec.md](./pricing-model-spec.md) §2–§4 — this table only defines *what* is metered; that doc is the source of truth for *how much, in which currency*, so prices aren't duplicated and drifted between the two files. Example full-template bills in both currencies (Family Starter, Workforce Essentials, Fleet Basic at typical usage) are sanity-checked there in §5.
| Data export | per export | All |

Each meter needs: a unit price, an optional **included allowance** per billing period (so e.g. "first 500 location pings/device/month free"), and an optional **hard cap** (so a runaway misconfiguration, e.g. 1-second screenshot interval, doesn't silently produce a huge bill — cap triggers an alert + throttle, not a surprise invoice).

## 5. Data Model Additions

- `LicenseTemplate` (id, name, is_predefined: bool, feature_flags{}, default_allowances{}, default_unit_prices{})
- `LicenseAgreement` (id, org_or_family_id, based_on_template_id_nullable, feature_flags{}, allowances{}, unit_prices{}, jurisdiction, accepted_at, accepted_by) — this is what actually governs provisioning; feature_flags here drive which `Policy` fields from the tier specs are active
- `MeterDefinition` (id, feature_key, unit_label, default_unit_price)
- `UsageMeterEvent` (id, license_agreement_id, meter_key, device_id_nullable, quantity, ts) — raw metering stream, aggregated into invoices
- `BillingPeriodInvoice` (id, license_agreement_id, period_start, period_end, line_items[{meter_key, quantity, unit_price, allowance_applied, subtotal}], total)
- `UsageCapEvent` (license_agreement_id, meter_key, cap_value, triggered_at) — fires when a hard cap is hit, notifies buyer, throttles further metering for that feature until acknowledged

Ties back into existing tier models: `Policy` (per tier spec) is now **derived from** `LicenseAgreement.feature_flags`, not configured independently — one source of truth for "what's on" that drives both disclosure screens and billing.

## 6. Consent/Disclosure Consistency (critical — ties billing to the no-covert-mode rule)

Because every feature toggle in the purchase flow maps 1:1 to a feature flag that also drives the consent/disclosure screens defined in each tier spec, **it's structurally impossible to buy a feature that isn't disclosed to the monitored user** — billing and disclosure read from the same `LicenseAgreement.feature_flags`. This is a deliberate architectural choice to keep "buy more surveillance" and "hide more surveillance" from ever being separate knobs.

## 7. Open Questions
- Billing cadence: pure postpaid usage-based (invoice after the fact) vs. prepaid credits/wallet model to avoid bill-shock? (Recommend: prepaid credit balance with low-balance alerts + postpaid true-up for enterprise/Fleet buyers only.)
- Per-device vs. per-org pooled allowances (e.g. is "500 free location pings" per device or pooled across the family)?
- How does template customization interact with jurisdiction gating from the tier specs — e.g. if a buyer in a mandatory-notice jurisdiction toggles on screenshots mid-cycle, does that require a *new* consent re-acceptance before the meter starts counting? (Recommend: yes — any feature_flag flip requires fresh `ConsentRecord` before provisioning, reusing the existing consent flow.)
- Currency/localization for unit pricing — resolved in [pricing-model-spec.md](./pricing-model-spec.md) §2: a buyer's billing currency is determined by their country (INR for India, USD default elsewhere in v1), not a single global currency. Open follow-up: timing and priority of adding a third currency beyond these two.
