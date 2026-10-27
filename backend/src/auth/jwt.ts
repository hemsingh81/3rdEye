import jwt from "jsonwebtoken";

// STORY-04 / system-architecture-spec.md §2.1: 1h expiry, no refresh-token
// flow yet — the smallest complete thing for Phase 1.
// Shortcut: this default secret is dev-only and insecure; a real secret
// (env-injected, rotated) is a prerequisite for anything beyond local dev
// and self-check runs — not building secret management now, flagging it
// so it isn't mistaken for a finished story.
export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-insecure-secret-do-not-use-in-production";

export interface JwtClaims {
  sub: string; // user id
  family_id: string;
  role: string;
}

export function signToken(claims: JwtClaims, expiresIn: string | number = "1h"): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): JwtClaims {
  return jwt.verify(token, JWT_SECRET) as JwtClaims;
}
