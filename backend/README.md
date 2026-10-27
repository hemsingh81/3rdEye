# 3rdEye Backend — Phase 0

Minimal backend for mvp-build-plan.md's Phase 0 exit criterion: a device can
enroll, show a consent screen, record acceptance, and show up in a dashboard.
No monitoring features, no metering, no event stream yet — those arrive with
later phases (see docs/specs/mvp-build-plan.md).

## Run locally (Podman)

```bash
podman compose -f podman-compose.yml up -d
DATABASE_URL="postgres://3rdeye:3rdeye@localhost:15432/3rdeye" npm run migrate
DATABASE_URL="postgres://3rdeye:3rdeye@localhost:15432/3rdeye" npm run dev
```

Admin console: http://localhost:8080

## Self-check

With the server running:

```bash
npm test
```

Exercises the full Phase 0 flow: create family → issue enrollment code →
fetch consent screen data → record consent → confirm the device shows as
enrolled in the dashboard listing.

## API

- `POST /api/families` `{ name }`
- `POST /api/devices` `{ family_id, platform }` → enrollment code
- `GET /api/devices/by-code/:code` → device + consent screen data
- `POST /api/devices/:id/consent` `{ accepted_by }` → records consent, marks device enrolled
- `GET /api/devices?family_id=` → dashboard listing
