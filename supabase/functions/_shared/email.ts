/**
 * Transactional email via Resend — the same call case-notify makes, lifted
 * so `noor` can send without duplicating it. case-notify is deliberately
 * left untouched; migrating it here is a separate, no-behaviour-change PR.
 *
 * Returns the Resend message id on success, null on failure. Never throws:
 * a failed email is a logged, audited outcome, not an exception that could
 * abort an agent run half-way.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export async function sendEmail(input: SendEmailInput, apiKey: string | undefined): Promise<string | null> {
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — email not sent");
    return null;
  }
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Dr-Crown <noreply@dr-crown.com>",
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      console.error("email: Resend responded", res.status, await res.text());
      return null;
    }
    const body = (await res.json()) as { id?: string };
    return body.id ?? "sent";
  } catch (err) {
    console.error("email: send failed", err);
    return null;
  }
}
