import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { familiesRouter } from "./routes/families.js";
import { devicesRouter } from "./routes/devices.js";
import { policyRouter } from "./routes/policy.js";
import { eventsRouter } from "./routes/events.js";
import { startStaleDeviceSweep } from "./staleDeviceSweep.js";

const app = express();
app.use(express.json());

app.use("/api/families", familiesRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/devices", policyRouter);
app.use("/api/devices", eventsRouter);

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

// Last resort: a bad request (e.g. a malformed UUID hitting Postgres) must
// return an error response, not crash the process — every route above is
// wrapped with asyncHandler so its errors land here instead of becoming an
// unhandled rejection.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: "bad request" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`3rdEye backend listening on :${port}`);
});

// STORY-03: runs every 15 minutes in production; configurable so a test
// doesn't have to wait for it — the self-check calls runStaleDeviceSweep()
// directly instead of waiting on this timer.
startStaleDeviceSweep(Number(process.env.STALE_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000));
