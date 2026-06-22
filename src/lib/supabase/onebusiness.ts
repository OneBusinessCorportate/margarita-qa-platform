import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only service client for the OneBusiness ("OB") Supabase project — the
 * authoritative debts system (schema `ob_app`). Separate project from the QA
 * app's "OB FAQ", so it needs its own URL + service-role key. Returns null when
 * not configured, so /api/debts/sync no-ops gracefully. NEVER import in client
 * components. The two env vars MUST be set on the host — see .env.example.
 */
// Typed against the ob_app schema, so widen the generics (not the default public).
let cached: SupabaseClient<any, any, any> | null | undefined;

export function getOneBusinessClient(): SupabaseClient<any, any, any> | null {
  if (cached !== undefined) return cached;
  const url = process.env.ONEBUSINESS_SUPABASE_URL;
  const key = process.env.ONEBUSINESS_SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          db: { schema: "ob_app" },
        })
      : null;
  return cached;
}

export function isOneBusinessConfigured(): boolean {
  return Boolean(
    process.env.ONEBUSINESS_SUPABASE_URL &&
      process.env.ONEBUSINESS_SUPABASE_SERVICE_ROLE_KEY
  );
}
