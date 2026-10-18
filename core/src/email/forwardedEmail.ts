import type { EmailMessage } from './EmailMessage.js';

/** "---------- Forwarded message ---------", "-----Original Message-----", Apple's "Begin forwarded message:". */
const FORWARD_MARKER =
  /^[ \t>]*-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,}[ \t]*$|^[ \t>]*Begin forwarded message:[ \t]*$/im;

const HEADER_LINE = /^(From|Date|Sent|Subject|To|Cc|Bcc|Reply-To):\s*(.*)$/i;

/** Parse the "Date:" of a forwarded header, e.g. "Wed, Apr 1, 2026 at 12:02 AM". */
function parseForwardedDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+at\s+/i, ' ').replace(/^[A-Za-z]{3,9},\s*/, '');
  const ms = Date.parse(cleaned);
  return Number.isFinite(ms) ? ms : undefined;
}

function unwrapOnce(message: EmailMessage): EmailMessage | undefined {
  const marker = FORWARD_MARKER.exec(message.body);
  if (!marker) return undefined;

  const lines = message.body.slice(marker.index + marker[0].length).split(/\r?\n/);
  const headers: Record<string, string> = {};
  let bodyStart = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.replace(/^[ \t>]+/, '').trim();
    if (!line) continue;
    const header = HEADER_LINE.exec(line);
    if (!header) {
      // The first non-header line after the header block is where the original body begins.
      if (Object.keys(headers).length > 0) {
        bodyStart = i;
        break;
      }
      continue;
    }
    headers[header[1]!.toLowerCase()] ??= header[2]!.trim();
  }

  if (!headers.from) return undefined;
  return {
    ...message,
    from: headers.from,
    subject: headers.subject ?? message.subject,
    body: lines.slice(bodyStart).join('\n'),
    // The original send time orders a forward correctly against later
    // cancellations of the same reservation.
    internalDate: parseForwardedDate(headers.date ?? headers.sent) ?? message.internalDate,
  };
}

/**
 * Reveal the original message inside a forward. A confirmation a relative
 * forwarded on is sent from THEIR address, so the sender, subject and body
 * that matter are the ones in the quoted header block. Returns the message
 * unchanged when it is not a forward. Handles forwards of forwards.
 */
export function unwrapForwarded(message: EmailMessage): EmailMessage {
  let current = message;
  for (let depth = 0; depth < 3; depth += 1) {
    const next = unwrapOnce(current);
    if (!next) break;
    current = next;
  }
  return current;
}
