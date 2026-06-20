import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@swr/core';
import { logger as defaultLogger } from '@swr/core';
import type { EmailMessage, EmailMessageSource, EmailQuery } from '@swr/core';
// Type-only import (erased at runtime); the package is lazily required below so
// the app still starts if google-auth-library is not installed.
import type { Credentials, OAuth2Client } from 'google-auth-library';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailMessageSourceOptions {
  clientId: string;
  clientSecret: string;
  /** Stored refresh token (from a prior authorization), if any. */
  refreshToken?: string;
  log?: Logger;
  /** Optional sink for raw email bodies when debug mode is on (for tuning). */
  debugDump?: (label: string, content: string) => void;
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailGetResponse {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  payload?: GmailPart;
}

/**
 * Gmail-backed {@link EmailMessageSource}.
 *
 * Uses OAuth 2.0 with the **read-only** Gmail scope. A desktop "loopback" flow
 * (RFC 8252) captures the authorization code on `http://127.0.0.1:<port>`; the
 * resulting refresh token is handed back to the caller to be encrypted at rest
 * (Windows DPAPI via SecretStore). google-auth-library is loaded lazily so the
 * app runs even before it is installed.
 */
export class GmailMessageSource implements EmailMessageSource {
  readonly id = 'gmail';
  private readonly log: Logger;
  private client: OAuth2Client | null = null;

  constructor(private readonly options: GmailMessageSourceOptions) {
    this.log = (options.log ?? defaultLogger).child('gmail');
  }

  async isConnected(): Promise<boolean> {
    return !!this.options.refreshToken;
  }

  /**
   * Run the interactive consent flow. Opens the system browser to Google's
   * consent screen and waits for the loopback redirect. Returns the refresh
   * token (to persist) and the connected account email.
   */
  async authorize(
    openUrl: (url: string) => Promise<void>,
    timeoutMs = 300_000,
  ): Promise<{ refreshToken: string; email?: string }> {
    const { OAuth2Client } = await this.loadLib();

    return new Promise<{ refreshToken: string; email?: string }>((resolve, reject) => {
      const server = createServer();
      let settled = false;

      const timer = setTimeout(() => finish(() => reject(new Error('Timed out waiting for Google authorization.'))), timeoutMs);

      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        action();
      };

      server.on('error', (err) => finish(() => reject(err)));

      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as AddressInfo).port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const client = new OAuth2Client({
          clientId: this.options.clientId,
          clientSecret: this.options.clientSecret,
          redirectUri,
        });

        server.on('request', (req: IncomingMessage, res: ServerResponse) => {
          void this.handleRedirect(req, res, client, redirectUri, finish, resolve, reject);
        });

        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [GMAIL_READONLY_SCOPE],
        });
        try {
          await openUrl(authUrl);
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      });
    });
  }

  private async handleRedirect(
    req: IncomingMessage,
    res: ServerResponse,
    client: OAuth2Client,
    redirectUri: string,
    finish: (action: () => void) => void,
    resolve: (v: { refreshToken: string; email?: string }) => void,
    reject: (e: Error) => void,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', redirectUri);
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');

    if (error) {
      respondHtml(res, 'Authorization was cancelled. You can close this tab.');
      finish(() => reject(new Error(`Google authorization failed: ${error}`)));
      return;
    }
    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code.');
      return;
    }

    try {
      const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        respondHtml(res, 'No refresh token returned. Remove the app from your Google account permissions and try again.');
        finish(() => reject(new Error('Google did not return a refresh token. Revoke access and retry with prompt=consent.')));
        return;
      }
      client.setCredentials(tokens);
      const email = await this.fetchProfileEmail(client).catch(() => undefined);
      respondHtml(res, 'Connected to Gmail! You can close this tab and return to Rebook Radar.');
      finish(() => resolve({ refreshToken, email }));
    } catch (err) {
      respondHtml(res, 'Failed to complete authorization. You can close this tab.');
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  }

  /** The email address of the connected account, or undefined if not connected. */
  async getProfileEmail(): Promise<string | undefined> {
    const client = await this.ensureClient();
    if (!client) return undefined;
    return this.fetchProfileEmail(client).catch(() => undefined);
  }

  async fetchMessages(query: EmailQuery): Promise<EmailMessage[]> {
    const client = await this.ensureClient();
    if (!client) throw new Error('Gmail is not connected.');

    const ids: string[] = [];
    let pageToken: string | undefined;
    const cap = query.maxResults ?? 200;
    do {
      const params: Record<string, string> = { q: query.query, maxResults: '100' };
      if (pageToken) params.pageToken = pageToken;
      const { data } = await client.request<GmailListResponse>({ url: `${GMAIL_API}/messages`, params });
      for (const m of data.messages ?? []) ids.push(m.id);
      pageToken = data.nextPageToken;
    } while (pageToken && ids.length < cap);

    const capped = ids.slice(0, cap);
    this.log.info('Listed Gmail messages', { matched: ids.length, fetching: capped.length });

    // Fetch message bodies in parallel batches (Gmail per-user rate limits are
    // generous; sequential GETs made a 400-email import take minutes).
    const BATCH = 20;
    const messages: EmailMessage[] = [];
    for (let i = 0; i < capped.length; i += BATCH) {
      const batch = capped.slice(i, i + BATCH);
      const fetched = await Promise.all(
        batch.map(async (id) => {
          const { data } = await client.request<GmailGetResponse>({
            url: `${GMAIL_API}/messages/${id}`,
            params: { format: 'full' },
          });
          return this.toEmailMessage(data);
        }),
      );
      messages.push(...fetched);
      this.log.info('Fetching Gmail bodies', { done: messages.length, total: capped.length });
    }
    this.log.info('Fetched Gmail messages', { count: messages.length });
    return messages;
  }

  // --- internals -----------------------------------------------------------

  private toEmailMessage(data: GmailGetResponse): EmailMessage {
    const headers = data.payload?.headers ?? [];
    const header = (name: string): string =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    const body = extractBody(data.payload);
    if (this.options.debugDump) {
      this.options.debugDump(`gmail-${data.id}`, `Subject: ${header('Subject')}\nFrom: ${header('From')}\n\n${body}`);
    }
    return {
      id: data.id,
      threadId: data.threadId,
      internalDate: Number.parseInt(data.internalDate, 10) || Date.now(),
      subject: header('Subject'),
      from: header('From'),
      body,
      snippet: data.snippet,
    };
  }

  private async fetchProfileEmail(client: OAuth2Client): Promise<string | undefined> {
    const { data } = await client.request<{ emailAddress?: string }>({ url: `${GMAIL_API}/profile` });
    return data.emailAddress;
  }

  private async ensureClient(): Promise<OAuth2Client | null> {
    if (!this.options.refreshToken) return null;
    if (this.client) return this.client;
    const { OAuth2Client } = await this.loadLib();
    this.client = new OAuth2Client({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
    });
    this.client.setCredentials({ refresh_token: this.options.refreshToken });
    return this.client;
  }

  private async loadLib(): Promise<typeof import('google-auth-library')> {
    try {
      return await import('google-auth-library');
    } catch {
      throw new Error(
        'google-auth-library is not installed. Run "npm install" in the project root to enable Gmail import.',
      );
    }
  }
}

function respondHtml(res: ServerResponse, message: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Rebook Radar</title></head>` +
      `<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;` +
      `align-items:center;justify-content:center;height:100vh;margin:0">` +
      `<div style="text-align:center"><h2 style="color:#38bdf8">Rebook Radar</h2>` +
      `<p>${message}</p></div></body></html>`,
  );
}

/** Recursively extract the best plain-text body from a Gmail payload tree. */
function extractBody(part: GmailPart | undefined): string {
  if (!part) return '';
  const plain = findByMime(part, 'text/plain');
  if (plain) return decodeData(plain);
  const html = findByMime(part, 'text/html');
  if (html) return stripHtml(decodeData(html));
  // Single-part message with inline body.
  if (part.body?.data) {
    const decoded = decodeData(part);
    return part.mimeType === 'text/html' ? stripHtml(decoded) : decoded;
  }
  return '';
}

function findByMime(part: GmailPart, mime: string): GmailPart | undefined {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findByMime(child, mime);
    if (found) return found;
  }
  return undefined;
}

function decodeData(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf8');
}

/** Convert HTML to readable plain text (no external deps). */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|table|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
