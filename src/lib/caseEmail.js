// Email uses a case reference and the sender's deliberate message. The
// patient/clinical context used by WhatsApp and copy is not added to email.
export function buildCaseEmail(caseId, note = "", signature = "") {
  const reference = String(caseId ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
  return {
    subject: `Dr-Crown case ${reference}`,
    body: [
      `Case: ${reference}`,
      "Sign in to Dr-Crown to view the prescription and appointment details.",
      "https://dr-crown.com/",
      String(note).trim(),
      signature,
    ].filter(Boolean).join("\n\n"),
  };
}
