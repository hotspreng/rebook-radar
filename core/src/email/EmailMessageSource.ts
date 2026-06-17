import { EmailMessage, EmailQuery } from './EmailMessage.js';

/**
 * Read-only email retrieval port (hexagonal architecture).
 *
 * Core defines WHAT it needs (search + fetch normalized messages); the desktop
 * layer supplies a Gmail-backed adapter (`GmailMessageSource`) and tests/web can
 * supply a fake. Core never imports Google APIs or any host SDK.
 *
 * Implementations MUST request read-only scope and MUST never expose tokens to
 * core — only normalized {@link EmailMessage} values cross this boundary.
 */
export interface EmailMessageSource {
  /** Stable id, e.g. `"gmail"`. */
  readonly id: string;

  /** Whether a usable, authorized connection currently exists. */
  isConnected(): Promise<boolean>;

  /** Fetch normalized messages matching the query, newest-first or any order. */
  fetchMessages(query: EmailQuery): Promise<EmailMessage[]>;
}
