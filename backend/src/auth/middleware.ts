import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtClaims } from "./jwt.js";

// Extends Express's Request with the verified claims — set by requireAuth,
// read by every route below it as the source of truth for "whose data is
// this," never a client-supplied family_id (that's the exact gap this
// story closes).
declare module "express-serve-static-core" {
  interface Request {
    auth?: JwtClaims;
  }
}

// Shortcut: Authorization: Bearer <token> only, not the httpOnly-cookie
// transport system-architecture-spec.md §2.1 names for the eventual browser
// Admin Console — that needs the cookie-parser dependency, not justified
// until STORY-05 actually builds that frontend. Add cookie support there,
// not speculatively here.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) return res.status(401).json({ error: "unauthenticated" });

  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    // Covers both an expired token and a malformed/invalid-signature one —
    // the caller doesn't need to distinguish, it just needs rejecting.
    return res.status(401).json({ error: "unauthenticated" });
  }
}
