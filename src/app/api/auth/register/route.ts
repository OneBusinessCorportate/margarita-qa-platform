import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
} from "@/lib/auth";
import { RegistrationError, registerUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let email = "";
  let password = "";
  let signupCode = "";
  try {
    const body = await req.json();
    email = String(body.email ?? "");
    password = String(body.password ?? "");
    signupCode = String(body.signupCode ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Optional gate: if SIGNUP_CODE is set, require it. Open registration when
  // unset (per current configuration). TODO(margarita): set SIGNUP_CODE to
  // restrict who can create accounts.
  const required = process.env.SIGNUP_CODE;
  if (required && signupCode !== required) {
    return NextResponse.json(
      { error: "Неверный код регистрации" },
      { status: 403 }
    );
  }

  try {
    const user = await registerUser(email, password);
    // Auto sign-in after successful registration.
    const token = await createSessionToken(user.email);
    const res = NextResponse.json({ ok: true }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    if (e instanceof RegistrationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Не удалось создать аккаунт" },
      { status: 500 }
    );
  }
}
