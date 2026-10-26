# 3rdEye — Code Signing, AV/EDR Compliance & Trust Building (Draft v0.1)

Scope: a release-engineering and go-to-market workstream, not a feature pillar. Covers what's needed so Windows Defender, macOS Gatekeeper/XProtect, and third-party AV/EDR do **not** flag the agent as Trojan/Spyware/PUP — on top of (not instead of) the product-level no-covert-mode design already in [product-spec.md](./product-spec.md). A clean architecture is necessary but not sufficient; this doc covers the sufficient part.

## 1. Why This Is a Separate Workstream

AV/EDR engines flag on **behavior signatures and binary trust**, not on stated intent. A product can be fully consent-based and transparent at the UX layer and *still* get auto-flagged if the binary is unsigned, has no reputation history, or trips a heuristic pattern common to generic spyware (e.g., `BitBlt`/`PrintWindow` screenshot calls + window-focus hooks + background network egress, which is exactly what screenshot/usage-tracking features (E1/E4) legitimately need to do). This workstream is how legitimate competitors (Teramind, ActivTrak, Jamf, Intune, Qustodio) stay unflagged — it's an established, solvable set of practices, not a research problem.

## 2. Code Signing Requirements (per platform)

| Platform | Requirement | Notes |
|---|---|---|
| **Windows** | EV (Extended Validation) code-signing certificate, or Microsoft **Trusted Signing** service, HSM-backed | Standard (non-EV) certs work but take longer to build SmartScreen reputation; EV gets instant reputation in most cases. Must sign every binary/installer/DLL, not just the top-level installer. |
| **macOS** | Apple Developer ID signing + **notarization** (required for Gatekeeper to allow the app to run without a manual override) | Agent must request entitlements (location, screen recording, accessibility) through normal `Info.plist`/TCC prompts — never attempt to suppress the macOS permission dialogs that already disclose access to the user. |
| **Android** | Standard Play Store app signing (or enterprise signing for MDM-distributed builds) | Google Play Protect scanning applies even for sideloaded/enterprise APKs; same behavioral-signature risk as desktop for anything resembling an Accessibility-Service keylogger pattern. |
| **iOS** | Apple Developer signing, App Store or Apple Business Manager (B2B) distribution | Apple's sandboxing makes most AV-evasion concerns moot — the bigger risk here is App Store review rejection for parental/monitoring category misuse, not AV flagging. |

**Action item:** add code-signing certificate acquisition and CI-integrated signing (every build artifact signed automatically, no manual/ad hoc signing) to the engineering setup checklist before any pilot distribution.

## 3. Reputation Building (Windows SmartScreen specifically)

- A brand-new signed binary with zero install history can still show a SmartScreen "few people run this" warning even when properly signed — this is a **volume/reputation** problem, not a validity problem.
- Mitigations:
  - Use EV cert or Trusted Signing (both get faster reputation than standard certs).
  - Keep a **stable signing identity** across versions — don't re-sign with a new cert per release; reputation accrues to the cert/publisher, and churn resets it.
  - Avoid frequent silent background updates immediately post-launch; a binary that changes hash too often re-triggers the "new file" heuristic each time.
  - Track SmartScreen warning rate as a release-readiness metric, not just functional QA.

## 4. Proactive AV Vendor Submission & Allowlisting

This is a real, documented step legitimate monitoring vendors take and should be a launch-checklist item, not an afterthought:
- Submit release binaries to **Microsoft Defender's false-positive portal** before general availability.
- Submit to major third-party AV vendors with a known "false positive / allowlist request" process (Norton, McAfee, Kaspersky, Bitdefender, etc.) — most have a form for legitimate monitoring/management software vendors.
- Maintain a **vendor contact list + resubmission runbook** since AV signature updates can re-flag a previously-cleared binary; this needs a monitoring/alerting step (e.g. automated check against VirusTotal on each release) so a regression is caught before a customer reports it, not after.

## 5. High-Risk Feature × Engineering Practice Matrix

| Feature(s) | Why it's heuristically risky | Required mitigation |
|---|---|---|
| E4 Screenshots, F1 lockout enforcement | Screen-capture APIs (`BitBlt`/`PrintWindow`) + window-focus hooks are a classic generic-spyware signature combination | Ship in a clearly-named, separately signed module; never attempt to minimize the module's footprint or hide its presence from Task Manager/Activity Monitor — doing so is itself a stronger AV trigger than the capture API alone |
| M2/M3 Remote lock/wipe, M7 Location | Remote-command-and-control-style network behavior (device receiving remote commands) resembles C2 beaconing patterns | Use documented MDM protocols (APNs for Apple, FCM/standard push for Android, native MDM channels for Windows) rather than a custom polling/beaconing protocol; custom protocols are what trips network-behavior heuristics, standard MDM channels are already allowlisted by OS vendors |
| E5 DLP file-event scanning | File-system watcher + USB/cloud-destination detection resembles exfil-detection-evading malware behavior if implemented naively | Use OS-native file-system event APIs (not low-level disk/kernel hooks); log metadata only, exactly as already scoped in employer-tier-spec.md — do not read file contents, which would both increase legal risk and heuristic risk |
| Any background network egress | Beaconing at malware-typical fixed intervals, or to IP-literal/newly-registered domains, triggers network-based EDR heuristics independent of the local binary | Use a stable, properly-registered domain with normal DNS/WHOIS history; avoid fixed-interval beaconing patterns; use standard HTTPS with a valid, non-self-signed TLS cert |

## 6. Process Checklist (add to release engineering, not just this doc)

1. Code-signing certificate(s) acquired and integrated into CI before first pilot build.
2. Every release binary scanned against VirusTotal (or equivalent) pre-release; any new flag blocks release until triaged.
3. AV vendor allowlist submissions filed for first GA release, with a runbook for re-submission on regression.
4. macOS notarization and Android Play Protect compliance verified per release, not just at initial launch.
5. Network architecture review specifically for "does this look like C2 beaconing" — sign-off required alongside normal security review.
6. Public-facing trust page (what the agent does, links to code-signing cert info, AV vendor allowlist status) — this is also a product-trust feature, not just an engineering one; ties into the consent/disclosure principle already in product-spec.md §2.

## 7. What This Doc Does Not Solve

- It does not make a **stealth-mode** build safe from AV flagging — that's a different problem entirely and out of scope for this product by design (see product-spec.md §2).
- It does not eliminate the **documented desktop app-install gap** noted in family-tier-spec.md §2.1 — that's a product capability boundary, not an AV/signing issue.
- Zero-day heuristic changes by AV vendors can still produce transient false positives even for fully compliant, signed, allowlisted software — the runbook in §6 is about fast detection and remediation, not a guarantee of zero flags ever.

## 8. Open Questions
- Which EV cert provider / Trusted Signing enrollment timeline fits the engineering schedule?
- Do we need a dedicated security/release engineer workstream owner for this, given it's cross-cutting across all three pillars and all four platforms?
- Should the public trust page be part of the Admin Console web product, or a separate marketing-site asset?
