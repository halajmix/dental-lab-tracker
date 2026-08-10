import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails loudly at startup rather than silently breaking every query later.
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example)."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Supabase parses a "type=recovery" reset-password link's URL hash and fires
// PASSWORD_RECOVERY as soon as the client above is constructed — which can
// resolve before React even mounts, let alone before useAuth's own listener
// (registered inside a useEffect, always deferred past the first paint) gets
// a chance to attach. Latching it here, at module scope — as early as it's
// possible to run any code in this app — guarantees we never lose the race
// and silently drop the user into the normal dashboard instead of the
// "set new password" screen.
export let recoveryDetectedEarly = false;
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") recoveryDetectedEarly = true;
});
