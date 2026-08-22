import nodemailer from "nodemailer";

function getMailTransport() {
  const isGmail = process.env.SMTP_PROVIDER === "gmail";
  return nodemailer.createTransport({
    host: isGmail ? "smtp.gmail.com" : (process.env.SMTP_HOST ?? "mailpit"),
    port: Number(isGmail ? 465 : (process.env.SMTP_PORT ?? 1025)),
    secure: isGmail,
    auth: isGmail
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
}

export async function sendSignerInvitation(input: { email: string; displayName?: string | null; token: string; expiresAt: Date }) {
  const baseUrl = process.env.SIGNER_INVITE_BASE_URL ?? "signbridge://set-password";
  const inviteUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(input.token)}`;
  const recipientName = input.displayName?.trim() || "Signer";
  await getMailTransport().sendMail({
    from: process.env.SMTP_FROM ?? "SignBridge <no-reply@localhost>",
    to: input.email,
    subject: "Set up your SignBridge signer account",
    text: `Hello ${recipientName},\n\nYou have been approved to submit a SignBridge signing sample. Set your password using this one-time link:\n${inviteUrl}\n\nThe link expires at ${input.expiresAt.toISOString()}. If you did not expect this invitation, you can ignore this message.`,
  });
  return { inviteUrl };
}
