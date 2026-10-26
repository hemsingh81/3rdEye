# 3rdEye — Pricing Model: Cost Basis, Final Meter Rates & Multi-Currency Billing (Draft v0.3)

Scope: replaces the placeholder unit prices scattered across [licensing-billing-spec.md](./licensing-billing-spec.md) §4 with actual cost-modeled numbers, and defines a **geo-based currency model**: a buyer's billing currency is determined by their country, not hardcoded to one currency — this is what lets the product serve the India market (where the business is based) and a global market from the same pricing engine, instead of picking one and excluding the other.

## 1. Methodology

1. **Cost basis is modeled in USD** — the underlying infra (managed Postgres, Kafka/Pub-Sub, APNs/FCM/WNS, cloud storage) is billed in USD by the providers regardless of where the customer is, so USD is the canonical currency for cost accounting, infra-cost comparisons, and the meter catalog's reference prices in [licensing-billing-spec.md](./licensing-billing-spec.md) §4.
2. **Apply a markup band by meter category**:
   - **High-volume, low-marginal-cost meters** (location pings, filter requests, device-days): 20–50x markup — these need to stay cheap enough that normal usage doesn't blow past included allowances, since the goal is predictable billing, not metering anxiety.
   - **Storage-heavy meters** (screenshots): 3–5x markup — storage cost is the real driver, and margin needs to cover ongoing retention, not just capture.
   - **Action/command meters** (remote lock/wipe/locate, exports): higher per-unit margin (5–10x) since these are low-frequency, high-value actions where cost isn't the bottleneck — willingness to pay is.
   - **Seat meters** (dashboard access): priced as a simple per-seat/month SaaS rate, not derived from infra cost at all.
3. **Round to a customer-legible number in each displayed currency**, not just the canonical one — a USD-derived INR price gets rounded to a clean rupee figure for an Indian buyer, even if that shifts margin slightly from a pure mechanical conversion. Same principle applies to any future currency.
4. **Sanity-check against §4's full-template scenarios**, in both currencies — if a realistic household/org blows past a "predictable" bill, the included allowance (not the unit price) is what should move.

## 2. Geo-Based Currency Model

- **Billing currency is determined by the buyer's country**, captured at signup (either detected via IP/locale and confirmed, or buyer-selected if detection is ambiguous) and stored on the `LicenseAgreement`/`Org`/`Family` record as a `currency` field (per [system-architecture-spec.md](./system-architecture-spec.md)'s data model) — not a global app-wide setting.
- **v1 ships with two currencies**: **INR** for buyers billed from India (the primary launch market), and **USD** as the default/global currency for everyone else. The architecture supports adding more currencies later (e.g. EUR, GBP) without a redesign — it's a rate-table + rounding-rule entry per currency, not a parallel pricing system.
- **Meters are counted in currency-agnostic units.** `UsageMeterEvent.quantity` (pings, requests, actions, etc.) is never currency-specific — only the final price calculation (`quantity × unit_price_in_buyer_currency`) applies a currency. This means switching a buyer's currency later (e.g. they relocate) doesn't require re-deriving historical usage, only re-pricing it.
- **FX conversion for non-USD, non-INR-table prices**: rather than computing INR prices by a live mechanical conversion every time, §4 below defines an **explicit, rounded INR price list**, refreshed periodically (recommend quarterly, or sooner if INR/USD moves more than ~10% from the reference rate used) rather than floating on a daily FX feed — this keeps a buyer's price stable and predictable instead of changing with exchange-rate noise. Any future third currency follows the same pattern: an explicit rounded price list per currency, not a live conversion shown at checkout.
- **Rate used for an invoice is locked at invoice-generation time** and recorded on the `BillingPeriodInvoice`, so a buyer's past invoices never retroactively change if the reference rate used for list-price-setting is later revised.
- **GST and other local tax handling is per-currency/per-jurisdiction**, not baked into the unit price (see §5) — an INR invoice carries GST as its own line item; a USD invoice to a non-India buyer follows that buyer's applicable tax rules (sales tax/VAT), out of scope to fully spec here but flagged so it isn't missed at implementation time.

## 3. Final Meter Rates — USD (canonical / global default)

| Meter | Est. infra cost/unit (USD) | Markup | **Final price (USD)** | Included allowance (default) | Hard cap (default) |
|---|---|---|---|---|---|
| Device active-device-day | $0.0003 | — (flat base fee, see §3.1) | **$0.03/device/day** (≈ $0.90/device/month) | n/a — base line | n/a |
| Dashboard seat (active-seat-day) | — (access/support cost) | — | **$1.00/seat/month** flat | 1 seat included per license | n/a |
| Location ping | $0.00002 | ~50x | **$0.001/ping** | 500 pings/device/month | 2,000 pings/device/month |
| Content filter request | $0.000008 | ~50x | **$0.0004/1,000 requests** | 50,000 requests/month | 500,000 requests/month |
| Screen-time policy evaluation | bundled into device-day | — | included in device-day | n/a | n/a |
| Screenshot capture | $0.0004 | ~4x | **$0.0016/capture** | 200 captures/device/month | 5,000 captures/device/month |
| DLP alert evaluation | $0.00004 | ~40x | **$0.0016/1,000 file-events** | 100,000 events/month | 1,000,000 events/month |
| MDM remote action | $0.002 | ~10x | **$0.02/action** | 5 actions/device/month | 50 actions/device/month |
| Compliance check run | bundled into device-day | — | included in device-day | n/a | n/a |
| Lost-mode active period | $0.01/day | ~5x | **$0.05/day active** | n/a (emergency state) | n/a |
| Data export | $0.02 | ~10x | **$0.20/export** | 2 exports/month | n/a |

### 3.1 Why device-days aren't metered the same way as everything else

Device enrollment should **not** behave like a pay-per-use line — a bill shouldn't depend on whether the agent happened to be running that day, which would also work against the offline-first design in [offline-sync-spec.md](./offline-sync-spec.md) (a device going offline shouldn't look like "less billed usage"). So device-day is a **flat per-enrolled-device rate**, charged for every day the device is enrolled regardless of online/offline state or actual feature usage — the base platform fee, with every other meter additive on top.

## 4. Final Meter Rates — INR (India)

Rounded, customer-legible INR prices for the India market, using a reference rate of **₹85 = $1 USD** at initial launch (per §2, revisited periodically rather than floated live):

| Meter | **Final price (INR)** | Included allowance | Hard cap |
|---|---|---|---|
| Device active-device-day | **₹2.50/device/day** (≈ ₹75/device/month) | n/a — base line | n/a |
| Dashboard seat | **₹80/seat/month** flat | 1 seat included | n/a |
| Location ping | **₹0.08/ping** | 500/device/month | 2,000/device/month |
| Content filter request | **₹0.03/1,000 requests** | 50,000/month | 500,000/month |
| Screenshot capture | **₹0.12/capture** | 200/device/month | 5,000/device/month |
| DLP alert evaluation | **₹0.12/1,000 file-events** | 100,000/month | 1,000,000/month |
| MDM remote action | **₹1.50/action** | 5/device/month | 50/device/month |
| Lost-mode active period | **₹4.00/day active** | n/a | n/a |
| Data export | **₹15.00/export** | 2/month | n/a |

## 5. Template Scenario Sanity Checks (both currencies)

### Family Starter — 5 devices, 1 parent seat, typical use
- **USD**: device base 5 × $0.90 = $4.50; content filtering ~100 units over allowance × $0.0004 = $0.04; location within allowance = $0.00; seat included = $0.00 → **~$4.54/month**.
- **INR**: device base 5 × ₹75 = ₹375; content filtering ~100 units × ₹0.03 = ₹3; location within allowance = ₹0; seat included = ₹0 → **~₹378/month**.
- Both land in the same place proportionally (₹378 ≈ $4.45 at the §4 reference rate vs. the $4.54 computed independently in USD) — the small gap is expected since allowance boundaries don't convert perfectly 1:1, and is well within "estimate" tolerance.

### Workforce Essentials — 5 devices, 1 manager seat, typical use
- **USD**: device base $4.50; DLP scanning modest overage ≈ $0.15; seat included $0.00 → **~$4.65/month** (≈ $0.93/employee/month) — for comparison, Teramind/ActivTrak-class per-seat monitoring SaaS runs $5–10/seat/month, so this sits comfortably below that on a usage-based model.
- **INR**: device base ₹375; DLP overage ≈ ₹13; seat included ₹0 → **~₹388/month** (≈ ₹78/employee/month) — commercial equivalents in the Indian market run roughly ₹400–850/seat/month, so again positioned well below flat-SaaS pricing.

### Fleet Basic — 5 company-owned devices, 1 IT viewer seat
- **USD**: device base $4.50; remote actions within allowance $0.00; viewer seat included $0.00 → **~$4.50/month** — reasonable against $2–8/device/month commercial MDM range.
- **INR**: device base ₹375; remote actions $0; viewer seat ₹0 → **~₹375/month** — reasonable against the ₹150–650/device/month Indian MDM market range.

**Conclusion holds in both currencies: allowances are sized so typical use sits near the device-base floor, with overage pricing only for above-typical usage** — predictable baseline, usage-based for the tail, per licensing-billing-spec.md §4.

## 6. Payment & Billing Infrastructure Notes

- **India (INR)**: GST (currently 18% on SaaS/software services) added as a separate invoice line, not baked into unit prices; GSTIN capture at signup for Employer-tier buyers needing input tax credit; India-first payment gateway (Razorpay/Cashfree/PayU) for UPI, net-banking, and card support; **UPI AutoPay** as the primary recurring-payment method, cards as fallback.
- **Rest of world (USD)**: standard international payment gateway (e.g. Stripe) for card-based recurring billing; local sales-tax/VAT handling deferred to a follow-up spec once a non-India launch market is picked, flagged here so it isn't forgotten.
- `BillingPeriodInvoice` (per system-architecture-spec.md) gains a `currency` field and a `fx_rate_used` field (null for USD-native and INR-native invoices under the explicit price-list model in §4, populated only if a future currency is priced by live conversion instead of an explicit list).

## 7. Updates This Makes to Other Specs

- [licensing-billing-spec.md](./licensing-billing-spec.md) §1's billing formula and §4's meter catalog reference this doc for actual unit prices (in the buyer's currency) rather than restating numbers.
- [system-architecture-spec.md](./system-architecture-spec.md)'s `LicenseAgreement`/`Org`/`Family` records gain a `currency` field; `BillingPeriodInvoice` gains `currency` and `fx_rate_used` per §6.
- The purchase-journey wireframe ([Artifact](https://claude.ai/artifact/E9v3yv9N456YUTJ4v21NiR)) shows an India-based buyer's checkout in ₹ as a worked example; a non-India buyer sees the identical flow in $ — the screens themselves don't change, only the currency label and converted numbers.

## 8. Open Questions
- Should the flat device-day base fee vary by template (Fleet devices might reasonably cost more as a base than Family, given heavier MDM enrollment infra) independent of the currency question?
- Annual prepaid discount (~15–20%) — worth offering in either currency to reduce churn?
- Which non-India market do we expect first real USD revenue from, and does that change the §6 "rest of world" payment-gateway/tax-handling priority?
- Reference-rate review cadence (§2 proposes quarterly) — is that the right interval, or should it be event-triggered (>X% FX move) instead of calendar-based?
