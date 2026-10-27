# 3rdEye — Testing Strategy: Mac Dev Host + Podman (Draft v0.1)

Scope: how to actually test the full system — backend services, all 4 agent platforms, offline enforcement, and AV/EDR safety — from a Mac development machine using Podman for the containerized backend, before any pilot release to real devices/stores. Ties into [system-architecture-spec.md](./system-architecture-spec.md) (the services being tested), [offline-sync-spec.md](./offline-sync-spec.md) (what "offline" testing actually verifies), [av-edr-compliance-spec.md](./av-edr-compliance-spec.md) (why Windows/AV testing needs its own environment), and [mvp-build-plan.md](./mvp-build-plan.md) (Phase 1 is Android + Windows — this doc's environment matrix is sequenced to match).

## 1. Core Constraint, Stated Plainly

**A Mac can natively run: the backend (via Podman), iOS Simulator, and macOS itself. It cannot natively run Android (needs an emulator/VM) or Windows (needs a VM) binaries.** This isn't a gap to work around cleverly — it's the normal situation for any cross-platform project, and the plan below just names the right tool for each platform instead of pretending one Mac can do everything.

| What you're testing | Runs natively on Mac? | What you actually use |
|---|---|---|
| Backend services (§2) | Yes | Podman + podman-compose |
| macOS agent | Yes | Direct build + run on the dev Mac (or a macOS VM for version matrix, §4) |
| iOS agent | Yes | Xcode + iOS Simulator |
| Android agent | No (needs emulation) | Android Studio + Android Emulator (arm64 system images run natively on Apple Silicon via hypervisor, no x86 translation penalty) |
| Windows agent | No | Windows VM (Parallels/UTM/cloud Windows VM) — see §4 |

## 2. Backend Stack via Podman

Podman replaces Docker here with the same compose workflow (`podman-compose`, or `podman play kube` for a Kubernetes-shaped manifest closer to production's actual orchestration). This stands up the services from system-architecture-spec.md §2/§6 locally:

```yaml
# podman-compose.yml (sketch — matches system-architecture-spec.md §6 dev-environment row)
services:
  postgres:
    image: postgres:16
    environment: [POSTGRES_PASSWORD=dev, POSTGRES_DB=thirdeye]
    ports: ["5432:5432"]
  redpanda:            # lighter Kafka-API-compatible broker for local dev, per system-architecture-spec.md §6
    image: redpandadata/redpanda:latest
    ports: ["9092:9092"]
  api-gateway:
    build: ./services/api-gateway
    ports: ["8080:8080"]
    depends_on: [postgres, redpanda]
  policy-consent-service:
    build: ./services/policy-consent
    depends_on: [postgres]
  event-ingestion-service:
    build: ./services/event-ingestion
    depends_on: [redpanda]
  metering-billing-service:
    build: ./services/metering-billing
    depends_on: [postgres, redpanda]
  notification-service:
    build: ./services/notification
    # push transport mocked in dev — see §5
  admin-console:
    build: ./apps/admin-console
    ports: ["3000:3000"]
    depends_on: [api-gateway]
```

Run with `podman-compose up`, or generate a Kubernetes-shaped manifest with `podman generate kube` once the compose file is stable, so the dev topology stays structurally close to the production Kubernetes deployment named in system-architecture-spec.md §6 — the goal is that "works in Podman locally" and "works in prod Kubernetes" stay the same shape, not two different architectures that happen to both run containers.

**Rootless by default**: Podman's rootless mode is the right default for a dev machine (no daemon running as root, unlike classic Docker) — keep it rootless unless a specific service genuinely needs elevated privileges, which none of the services above do.

## 3. Agent-Side Testing per Platform

### 3.1 iOS (native on Mac)
- Xcode + iOS Simulator, agent built against the local Podman backend (`http://localhost:8080` or a `ngrok`/local-tunnel URL if testing from a physical device instead of the simulator).
- Family Controls / Screen Time framework **cannot be fully exercised in the Simulator** — Apple's parental-control APIs require Family Sharing with a real (or sandboxed Apple ID) and in some cases a physical device. Plan for a short physical-device test pass (even just the dev's own iPhone/iPad with a test Apple ID) before considering iOS lockout "verified," not just simulator-tested.

### 3.2 Android (emulator on Mac)
- Android Studio + an arm64 system image (native on Apple Silicon, no x86 emulation tax) — Family Link Device Policy Controller behavior can be exercised more fully in the emulator than iOS's equivalent, since Android's parental APIs don't require the same account-linking ceremony for basic testing.
- Point the emulator at the Podman backend via `10.0.2.2:8080` (the emulator's alias for the host machine).

### 3.3 macOS (native on Mac)
- Build and run directly on the dev Mac for day-to-day iteration.
- For OS-version coverage (the Screen Time/Family Sharing framework has changed across macOS releases), use a **macOS VM** — on Apple Silicon, Apple's own Virtualization framework supports this (via tools like **Tart** or **UTM**, both of which can run licensed macOS VMs on Apple hardware, which is the only lawful way to run macOS in a VM). Don't reach for a non-Apple hypervisor trick to dodge this — it's both against the license and unnecessary, since Apple's own virtualization story on Apple Silicon is solid.

### 3.4 Windows (VM required, Mac can't run it natively)
- **UTM or Parallels Desktop** running a licensed Windows image is the straightforward local option on a Mac.
- For the actual AV/EDR validation pass (not just functional testing), prefer a **cloud Windows VM** (Azure/AWS Windows instance) over a permanently-local one — this matters because av-edr-compliance-spec.md's checklist needs a Windows instance with **real, up-to-date Windows Defender definitions**, which is easier to guarantee fresh on a cloud VM you can snapshot/reset than on a long-lived local VM that might drift.
- Family Safety (screen-time lockout) and MDM protocol testing (Autopilot/Intune-style enrollment) both need this VM — functional testing can happen on the local UTM/Parallels VM day-to-day, with the cloud VM reserved for pre-release AV/Defender validation specifically.

## 4. Device/Environment Matrix Summary

| Platform | Day-to-day dev testing | Pre-release validation |
|---|---|---|
| Android | Android Studio emulator (arm64) | + at least one physical device (emulators don't perfectly replicate Family Link/DPC enforcement) |
| iOS | iOS Simulator | + a physical device for Family Controls framework (required, not optional — simulator can't fully exercise it) |
| macOS | Dev Mac directly | + Tart/UTM VM for OS-version matrix (current + previous major release at minimum) |
| Windows | Local UTM/Parallels VM | + cloud Windows VM with live Defender for the AV/EDR checklist (av-edr-compliance-spec.md §6) |

## 5. Mocking Platform Push/MDM Transports in Dev

Local dev shouldn't require real APNs/FCM/WNS credentials for every iteration loop:
- **Notification Service** (system-architecture-spec.md §2) runs in a "mock transport" mode locally — logs what it *would* send instead of actually calling APNs/FCM/WNS, with a small local test harness (even just reading the mock log, or a minimal local web view) standing in for "did the push arrive."
- **MDM Command Service** similarly mocks the real MDM protocol handshake in dev — exercising the command-issued → command-acknowledged flow against a stub, not real Apple Business Manager/Android Enterprise/Intune infrastructure, which needs real enrolled devices and is reserved for staging/pre-release (§6).
- Real push/MDM credentials (sandbox tier — APNs sandbox, FCM test project) get introduced at the **staging** environment, not local dev, matching system-architecture-spec.md §7's environment table.

## 5.1 Dev-Only Standalone Mode (fastest local-iteration path)

For iterating on the local policy engine itself (lockout, filtering, etc.) without needing the Podman backend running at all, see [dev-standalone-mode-spec.md](./dev-standalone-mode-spec.md) — a dev-build-only config file that seeds a synthetic policy/consent record and runs the agent fully offline from the start, no enrollment, no backend. A sample file is at [dev-tools/dev-standalone-config.sample.txt](../../dev-tools/dev-standalone-config.sample.txt). Use this first while building/testing enforcement logic on the Windows laptop (or any test machine); switch to the real LAN-connected Podman backend (§2) once testing the actual consent/sync/billing path end-to-end.

## 6. Testing the Offline-First Requirement (ties to offline-sync-spec.md)

This is the one requirement that needs deliberate, repeatable network-failure testing, not just "it worked when I tried it":

- **Simulator/emulator network toggle**: both Android Emulator and iOS Simulator (when paired with a physical-device test pass per §3.1) support airplane-mode-equivalent toggles — use this as the first, cheapest offline test.
- **macOS Network Link Conditioner** (part of Apple's free "Additional Tools for Xcode" download) can simulate not just "no network" but degraded/flaky connections (packet loss, high latency) — more realistic than a hard on/off toggle, and worth using for testing the sync protocol's retry/backoff behavior, not just the binary offline case.
- **Windows VM**: disable the virtual network adapter (or use a tool like Clumsy for packet-loss/latency injection) for the equivalent test on the Windows agent.
- **Required test scenarios per offline-sync-spec.md**:
  1. Enforce a feature (e.g. F1 lockout) with the device in airplane mode from the start — confirms local policy cache + enforcement works with zero prior connectivity in this session.
  2. Go offline mid-session after policy was already synced, confirm enforcement continues.
  3. Queue events offline for an extended period (simulate hours, not just seconds), then reconnect — confirm the sync protocol's batched flush, idempotency (no duplicate billing events), and timestamp-authoritative aggregation all behave as specified.
  4. Flip a feature flag server-side while a device is offline, reconnect, confirm the device shows re-consent **before** the new feature activates (per offline-sync-spec.md §4 step 5) rather than silently applying it.
  5. Issue a remote lock/wipe command to an offline device, confirm it queues server-side and only applies once the device reconnects (per offline-sync-spec.md §2's "inherently requires connectivity" list) — this test should assert the correct *pending* behavior, not treat a delay as a bug.

## 7. End-to-End Test Scenarios (mapped to mvp-build-plan.md phases)

| Phase | Primary test scenario |
|---|---|
| Phase 0 | Device enrolls → sees consent screen → accepts → shows up in Admin Console with a `last_synced_at` timestamp |
| Phase 1 (MVP) | Android emulator + Windows VM: set a screen-time limit, trigger lockout **in airplane mode**, confirm child-visible disclosure screen renders from the local queue |
| Phase 2 | Full Family-tier feature pass on the same 2 platforms, including app-install approval's offline default behavior |
| Phase 3 | Repeat Phase 1–2 scenarios on iOS Simulator + a physical iPhone, and a macOS VM/dev Mac |
| Phase 4 | Employer-tier scenarios (usage tracking, screenshot capture + local storage cap, DLP alert) + first real metered invoice generated from Podman-stack-recorded `UsageMeterEvent`s, cross-checked against pricing-model-spec.md's worked examples |
| Phase 5 | Fleet-tier MDM enrollment + remote lock/wipe against sandbox Apple Business Manager / Android Enterprise / Intune test tenants (not mocked — this phase needs the real sandbox programs, which are free to register for but take lead time to set up) |

## 8. CI Integration

- The Podman-based backend stack should run in CI (GitHub Actions or equivalent) for every backend PR — spin up via `podman-compose`, run integration tests against it, tear down. This keeps "works on my Mac" and "works in CI" the same stack, not a divergent one.
- Agent-side CI: Android/iOS builds can run against the same ephemeral Podman-based backend spun up in a CI job (GitHub Actions supports both macOS and Linux runners; macOS runners are needed for iOS/macOS agent builds regardless of Podman). Windows agent CI needs a Windows runner — GitHub Actions provides these natively, separate from the Podman/Mac question entirely.
- Per av-edr-compliance-spec.md §6, the **code-signing + VirusTotal scan** step belongs in this same CI pipeline for the Windows/macOS builds specifically — a build that fails that scan should block merge, the same as a failing test.

## 9. What This Doesn't Replace

- **Real AV/EDR validation** (live Defender definitions, real SmartScreen reputation behavior) cannot be meaningfully done in a throwaway local VM — use the cloud Windows VM path from §3.4 for that specific pass, on a cadence tied to releases, not every local test run.
- **Real App Store / Google Play / Apple Business Manager / Android Enterprise review and sandbox testing** — none of this is replaced by local Podman + emulator/VM testing; it's a separate, later gate before any real pilot distribution, per mvp-build-plan.md's phase sequencing.
- **Real-device offline testing** (a physical phone genuinely out of signal range, not just a simulator toggle) — worth at least one manual pass per platform before calling the offline-first requirement actually verified, since a simulator's "airplane mode" and a real device's radio behavior aren't always identical in subtle ways (e.g. background task scheduling differences).

## 10. Open Questions
- Self-hosted GitHub Actions macOS/Windows runners vs. GitHub-hosted — cost/speed tradeoff once CI volume grows past free-tier limits?
- Should the cloud Windows VM for AV validation be a persistent reserved instance or spun up per-release and torn down (cost vs. convenience)?
- Minimum OS-version test matrix per platform (e.g. "current + previous major release" is proposed in §3.3 for macOS — same policy for Android/iOS/Windows)?
