// Minimal credentials auth: validate against AUTH_USERS, issue a signed JWT in
// an httpOnly cookie. Edge-compatible (uses jose). Internal tool only.
//
// TODO(margarita): hash stored passwords and move users into the DB. For v1
// they live in AUTH_USERS ("email:password,email:password").
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "qa_session";
const ALG = "HS256";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  return new TextEncoder().encode(s);
}

// NOTE: credential verification + password hashing live in src/lib/users.ts
// (Node runtime only). This module stays edge-safe (jose only) so it can be
// imported by middleware.

export interface SessionPayload {
  email: string;
}

export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.email === "string") return { email: payload.email };
    return null;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;
