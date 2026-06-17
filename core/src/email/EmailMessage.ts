/**
 * A normalized email message handed to the parser. The host (desktop Gmail
 * adapter) is responsible for fetching and flattening provider-specific
 * payloads into this shape so the parser stays framework-agnostic.
 */
export interface EmailMessage {
  /** Provider message id (Gmail message id). */
  id: string;
  /** Provider thread id, when available. */
  threadId?: string;
  /**
   * Milliseconds since the Unix epoch when the provider received the message
   * (Gmail `internalDate`). Used to order events chronologically.
   */
  internalDate: number;
  /** Subject line. */
  subject: string;
  /** Raw `From` header, e.g. `"Southwest Airlines" <no-reply@iluv.southwest.com>`. */
  from: string;
  /** Plain-text body. The adapter strips HTML before handing it over. */
  body: string;
  /** Short provider-supplied preview snippet, when available. */
  snippet?: string;
}

/** A Gmail-style search query plus an optional cap on results. */
export interface EmailQuery {
  /** Gmail search expression, e.g. `from:southwest.com newer_than:12m`. */
  query: string;
  /** Maximum number of messages to retrieve. */
  maxResults?: number;
}
