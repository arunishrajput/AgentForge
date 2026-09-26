import { apiErrorMessage, IntegrationError, readBody, request } from "./net";

/**
 * Gmail — send one message.
 *
 * The API takes no `to`/`subject`/`body` fields. It takes `raw`: an entire RFC 2822
 * message, **base64url** encoded (confirmed on the live discovery document). So the
 * work here is building a correct message, and two parts of that are the failure
 * modes worth naming:
 *
 *  • **base64url, not base64.** Plain base64 contains `+` and `/`, and Gmail answers
 *    400 to them. The difference is three characters and it breaks every send.
 *  • **A header may not contain a newline.** A subject taken from a webhook payload
 *    is attacker-controlled text, and a `\r\n` inside it splices arbitrary headers
 *    into the message — a `Bcc:` of the attacker's choosing, for instance. Header
 *    values are therefore stripped of CR and LF before they are assembled. This is
 *    the reason `buildMessage` is a pure function with its own test: it is a header
 *    injection guard, and it must be assertable without sending mail.
 *
 * Non-ASCII is handled by encoding the whole message as UTF-8 and declaring it,
 * rather than by RFC 2047 word-encoding each header — which keeps this short and is
 * what Gmail's own clients accept.
 */

const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  /** The authenticated mailbox. Gmail overrides a wrong one; included for clarity. */
  from?: string;
  cc?: string;
}

/** Removes anything that could begin a new header line. */
export function sanitiseHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * A minimal but correct `text/plain; charset=utf-8` message.
 *
 * Header/body separation is a bare `\r\n\r\n` and line endings are CRLF throughout,
 * which is what RFC 2822 requires and what a bare `\n` quietly violates.
 */
export function buildMessage(message: MailMessage): string {
  const to = sanitiseHeader(message.to);
  if (to.length === 0) throw new IntegrationError("A recipient is required.");

  const headers = [
    `To: ${to}`,
    ...(message.cc ? [`Cc: ${sanitiseHeader(message.cc)}`] : []),
    ...(message.from ? [`From: ${sanitiseHeader(message.from)}`] : []),
    `Subject: ${sanitiseHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];

  // The body is the one place a newline is meaningful, so it is normalised to CRLF
  // rather than stripped.
  const body = message.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export interface SendResult {
  messageId: string | null;
  threadId: string | null;
}

export async function sendMail(options: {
  accessToken: string;
  message: MailMessage;
  signal?: AbortSignal;
}): Promise<SendResult> {
  const raw = base64url(buildMessage(options.message));

  const response = await request(SEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
    timeoutMs: 20_000,
    signal: options.signal,
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new IntegrationError(
      `Gmail refused the message: ${apiErrorMessage(body, `HTTP ${response.status}`)}`,
      response.status,
    );
  }

  const json = (body.json ?? {}) as Record<string, unknown>;
  return {
    messageId: typeof json.id === "string" ? json.id : null,
    threadId: typeof json.threadId === "string" ? json.threadId : null,
  };
}
