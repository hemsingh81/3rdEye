# 3rdEye

A disclosed, consent-based device-management product — parental controls,
workforce monitoring, and MDM/anti-theft fleet management, unified under
one product with one non-negotiable rule: **no hidden/stealth operating
mode, ever.**

## Start here

- [docs/specs/product-spec.md](docs/specs/product-spec.md) — the full
  vision and the non-negotiable constraints.
- [docs/specs/mvp-build-plan.md](docs/specs/mvp-build-plan.md) — what ships
  first, in what order.
- [docs/specs/implementation-plan.md](docs/specs/implementation-plan.md) —
  the actual next tickets, grounded in what's really built.
- [CLAUDE.md](CLAUDE.md) — the development workflow every story follows
  (analyze → split into tasks → code → test → review → document), and the
  local dev/testing process.

## Repo layout

| Path | What's there |
|---|---|
| `docs/specs/` | Every spec, cross-linked |
| `backend/` | Node/TypeScript + Postgres — enroll, consent, policy APIs |
| `agents/windows/` | Windows agent source (compile-checked only, never run — no Windows machine in dev) |
| `prototype/` | Static HTML mockups: feature map, role dashboards, public marketing site |
| `scripts/` | Local dev loop: Podman up/down/reset, migrate, dev server, self-check |

## Quickstart (backend)

```bash
./scripts/dev.sh     # starts Postgres (Podman), migrates, runs the backend
./scripts/test.sh    # in another terminal: runs the self-check
```

See [CLAUDE.md](CLAUDE.md) for why these scripts exist instead of running
Podman commands directly — this machine hosts other, unrelated projects'
containers, and these scripts are scoped so they can never touch them.
