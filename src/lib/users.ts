// User accounts + credential checks. Node runtime ONLY (uses node:crypto).
// Never import this from middleware (edge) — middleware only verifies the JWT
// via src/lib/auth.ts.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getServiceClient } from "./supabase/server";
import { store } from "./mock-store";
import { TABLES } from "./tables";

// --- password hashing (scrypt, no external deps) ---------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- bootstrap users from env (AUTH_USERS, plaintext) ----------------------
// These always work even before any account is created (e.g. first admin).
// TODO(margarita): retire AUTH_USERS once real accounts exist.
function envUsers(): { email: string; password: string }[] {
  const raw = process.env.AUTH_USERS;
  if (!raw) return [{ email: "info@onebusiness.am", password: "changeme" }];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(":");
      return { email: p.slice(0, i).trim().toLowerCase(), password: p.slice(i + 1) };
    });
}

// --- DB / mock user records ------------------------------------------------

interface StoredUser {
  email: string;
  password_hash: string;
}

async function findUser(email: string): Promise<StoredUser | null> {
  const e = email.trim().toLowerCase();
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.users)
      .select("email,password_hash")
      .eq("email", e)
      .maybeSingle();
    if (error) throw error;
    return (data as StoredUser) ?? null;
  }
  return store().users.find((u) => u.email === e) ?? null;
}

export class RegistrationError extends Error {}

/** Create an account. Throws RegistrationError on validation / conflict. */
export async function registerUser(
  email: string,
  password: string
): Promise<{ email: string }> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    throw new RegistrationError("Введите корректный email");
  }
  if (password.length < 6) {
    throw new RegistrationError("Пароль должен быть не короче 6 символов");
  }
  if (envUsers().some((u) => u.email === e) || (await findUser(e))) {
    throw new RegistrationError("Пользователь с таким email уже существует");
  }

  const password_hash = hashPassword(password);
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.users)
      .insert({ email: e, password_hash });
    if (error) {
      // Unique-violation safety net.
      if ((error as any).code === "23505") {
        throw new RegistrationError("Пользователь с таким email уже существует");
      }
      throw error;
    }
  } else {
    store().users.push({ email: e, password_hash });
  }
  return { email: e };
}

/** Validate login credentials against env bootstrap users, then DB/mock users. */
export async function authenticate(
  email: string,
  password: string
): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (envUsers().some((u) => u.email === e && u.password === password)) {
    return true;
  }
  const user = await findUser(e);
  return user ? verifyPassword(password, user.password_hash) : false;
}
