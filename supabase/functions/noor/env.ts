/* The only file that touches Deno.env. Everything else receives values. */
export interface NoorEnv {
  supabaseUrl: string; anonKey: string; serviceKey: string;
  webhookSecret: string | undefined; resendKey: string | undefined; anthropicKey: string | undefined;
  shadow: boolean; modelAnswer: string; modelPhrase: string; effort: "low" | "medium" | "high";
  staleDays: number; maxToolCalls: number; toolTimeoutMs: number; runTimeoutMs: number; maxTokens: number;
  userPerHour: number; tenantPerDay: number;
}
export function readEnv(): NoorEnv {
  const g = (k: string) => Deno.env.get(k);
  return {
    supabaseUrl: g("SUPABASE_URL") ?? "", anonKey: g("SUPABASE_ANON_KEY") ?? "", serviceKey: g("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    webhookSecret: g("CASE_NOTIFY_SECRET"), resendKey: g("RESEND_API_KEY"), anthropicKey: g("ANTHROPIC_API_KEY"),
    shadow: (g("NOOR_SHADOW") ?? "true") !== "false",
    // Answering model per current Anthropic guidance; phrasing on the cheap tier.
    modelAnswer: g("NOOR_MODEL_ANSWER") ?? "claude-opus-5",
    modelPhrase: g("NOOR_MODEL_PHRASE") ?? "claude-haiku-4-5",
    effort: (g("NOOR_EFFORT") as NoorEnv["effort"]) ?? "medium",
    staleDays: Number(g("NOOR_STALE_DAYS") ?? 5), maxToolCalls: Number(g("NOOR_MAX_TOOL_CALLS") ?? 8),
    toolTimeoutMs: Number(g("NOOR_TOOL_TIMEOUT_MS") ?? 10000), runTimeoutMs: Number(g("NOOR_RUN_TIMEOUT_MS") ?? 45000),
    maxTokens: Number(g("NOOR_MAX_TOKENS") ?? 4000),
    userPerHour: Number(g("NOOR_USER_PER_HOUR") ?? 20), tenantPerDay: Number(g("NOOR_TENANT_PER_DAY") ?? 200),
  };
}
