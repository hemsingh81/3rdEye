# CLAUDE.md — 3rdEye development guide

This file is the project-level instructions for any Claude Code session (or
any developer) working in this repo. Read it before starting a story.

## What this project is

3rdEye is a disclosed, never-covert device-management product — parental
controls, workforce monitoring, and MDM/anti-theft, unified under one
product. The one constraint that overrides everything else below:
**no hidden/stealth operating mode, ever** (product-spec.md §2). If a
story's request conflicts with that, the constraint wins — flag it back to
whoever wrote the story rather than finding a clever way around it.

Start here, in this order: [docs/specs/product-spec.md](docs/specs/product-spec.md) →
[docs/specs/mvp-build-plan.md](docs/specs/mvp-build-plan.md) →
[docs/specs/implementation-plan.md](docs/specs/implementation-plan.md) (why
each task exists) → [docs/specs/development-stories.md](docs/specs/development-stories.md)
(the actual backlog — pick a story from here, not from implementation-plan.md directly).

## Development story workflow

Every story — whether it's a one-line fix or a new feature — follows these
steps, in order. Don't skip a step because the story looks small; skip
*scope*, not *steps*.

### 1. Analyze
- Find which spec(s) under `docs/specs/` the story maps to. If none do,
  that's a signal the story needs a spec update, not just code — see
  [implementation-plan.md](docs/specs/implementation-plan.md)'s own pattern
  of recording decisions before building them.
- Check [implementation-plan.md §0](docs/specs/implementation-plan.md) for
  what's *actually* built already — don't assume a spec's target state is
  live; this repo has caught real drift between the two before (the
  Android DPC capability overstatement, fixed in `207e5a7`, existed because
  nobody checked this).
- Note the smallest change that fully satisfies the story. Name anything
  bigger that the story *doesn't* need, in one line, rather than building it
  quietly (the ponytail pattern used throughout this repo's spec work).

### 2. Split into tasks
- Break the story into ordered subtasks with explicit acceptance criteria —
  match the style already used in implementation-plan.md §1 (a "why," a
  concrete change, an "acceptance" line).
- If a subtask reveals the story is bigger than it looked, say so and
  re-split rather than quietly expanding scope mid-task.

### 3. Code
- Smallest complete change (see `.claude`/session conventions below).
- Follow existing patterns, don't invent parallel ones: every async Express
  route is wrapped in `asyncHandler` (backend/src/asyncHandler.ts); every
  migration is a new numbered file under `backend/migrations/`, never an
  edit to one already applied; every offline-capable feature follows the
  cache-then-enforce-locally pattern already in `agents/windows/PolicyClient.cs`.

### 4. Test
- Backend: extend `backend/src/test.ts` — it's a running self-check, not a
  framework; add assertions for the new behavior, run it, and don't report
  a task done without a clean pass. See "Dev & testing process" below for
  how to actually run it.
- Agents (Windows/Android): this environment has no real Windows or Android
  runtime — compile-check only (`dotnet build` for Windows), and say
  explicitly that it was never run, the same way `agents/windows/README.md`
  already does. Don't imply it was tested on a real device when it wasn't.

### 5. Review
- Re-read the diff looking specifically for the two bug classes this repo
  has already found the hard way: an error path that crashes instead of
  returning a clean response (fixed in `d040b88`), and a stateful loop that
  never resets/re-arms (the Windows lockout's daily-reset bug, also
  `d040b88`). Both were found by actually running the code, not by reading
  it — do the same before calling a task reviewed.
- Check: does this still match the spec it came from? Did it quietly grow
  scope? Do any spec cross-links need updating (a broken link check is one
  `grep`/`sed` one-liner — see any recent commit for the exact command)?

### 6. Document and commit
- Update the relevant spec and/or `implementation-plan.md` if the story
  changed scope, sequencing, or a prior decision — specs in this repo are
  meant to track reality, not just intent.
- Commit message explains *why*, not just *what* (see this repo's git log
  for the established style) and ends with the attribution line this
  session's system prompt specifies, when one is given.

## Dev & testing process

**This machine runs other, unrelated Podman projects side by side with
3rdEye's.** Every script under `scripts/` is scoped to the `3rdeye` compose
project name (`backend/podman-compose.yml`'s `name:` field) for exactly
this reason. **Never run a bare `podman stop`/`rm`/`prune` across all
containers** — always go through these scripts, which can't touch anything
outside this project:

| Script | What it does |
|---|---|
| `scripts/podman-up.sh` | Starts (or resumes) only the 3rdEye Postgres container |
| `scripts/podman-down.sh` | Stops it, keeps the data volume |
| `scripts/podman-reset.sh` | Wipes *only* the 3rdEye dev database (asks first) |
| `scripts/migrate.sh` | Applies `backend/migrations/*.sql` |
| `scripts/dev.sh` | Up + migrate + run the backend with auto-reload (foreground) |
| `scripts/test.sh` | Runs `backend/src/test.ts` against a running dev server |

**Normal loop:** `./scripts/dev.sh` in one terminal, `./scripts/test.sh` in
another once it's up. Both are idempotent — running `podman-up.sh` against
an already-running stack is a no-op, not an error.

## Conventions this repo has already established (don't rediscover them)

- **Ponytail discipline**: smallest complete change; name what you skipped
  and any risk, every time — this is how every spec and code change in
  this repo's history was reviewed.
- **Deferred work stays deferred**: pricing-model-spec.md, the
  Employer/Fleet tier specs, and ai-behavior-analysis-spec.md are all
  explicitly marked deferred past their mvp-build-plan.md phase. Don't
  start building them because a story touches an adjacent area — check the
  phase gate first.
- **Spec cross-links must resolve.** Before committing a spec change, verify
  every `](./something.md)` link in every file under `docs/specs/` still
  points to a real file — this has caught real mistakes before.
- **Known fixed bugs, don't reintroduce them**: the backend's global error
  handler (`backend/src/server.ts`) must wrap every async route — removing
  that reintroduces the crash-on-bad-input bug from `d040b88`. The Windows
  `LockoutEnforcer`'s daily reset and per-trigger guards must carry over to
  any new platform's lockout logic (android-agent-spec.md §3 says this
  explicitly for Android) — it's the exact same bug class waiting to happen
  again on a new platform if nobody checks for it.

## Where things live

- `docs/specs/` — every spec, cross-linked; start with product-spec.md
- `backend/` — Node/TypeScript + Postgres, the only thing actually running
- `agents/windows/` — Windows agent source, compile-checked only, never run
- `prototype/` — static HTML mockups (feature map, dashboards, marketing
  site) — not wired to the real backend, for reviewing scope before building
- `scripts/` — the Podman/dev/test scripts described above
