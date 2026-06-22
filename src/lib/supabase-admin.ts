import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for machine-to-machine access (e.g. the Hermes
// integration endpoint). It has no user session and bypasses RLS, so it must
// only ever be used inside server-side code guarded by its own auth check —
// never imported into a client component.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
