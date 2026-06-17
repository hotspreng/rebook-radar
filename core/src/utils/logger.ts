/**
 * Lightweight, framework-agnostic logger.
 *
 * - No external dependencies (works in Node and browser).
 * - Redacts values that look like secrets so credentials are never logged.
 * - Log level and debug mode are injected, not read from process.env directly,
 *   keeping this module portable to the web client.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** Keys whose values must never appear in logs. */
const SENSITIVE_KEYS = [
  'password',
  'pass',
  'secret',
  'token',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'session',
];

export interface LoggerOptions {
  level?: LogLevel;
  /** Component/namespace prefix, e.g. "core:pricing". */
  namespace?: string;
  /** Sink for output. Defaults to console. */
  sink?: (level: LogLevel, message: string, meta?: unknown) => void;
}

/** Recursively redact sensitive fields from an object for safe logging. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
        out[key] = '«redacted»';
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export class Logger {
  private level: LogLevel;
  private namespace: string;
  private sink: NonNullable<LoggerOptions['sink']>;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.namespace = options.namespace ?? 'core';
    this.sink =
      options.sink ??
      ((level, message, meta) => {
        const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
        // eslint-disable-next-line no-console
        const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        if (meta !== undefined) fn(line, meta);
        else fn(line);
      });
  }

  child(namespace: string): Logger {
    return new Logger({
      level: this.level,
      namespace: `${this.namespace}:${namespace}`,
      sink: this.sink,
    });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[this.level];
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;
    const safeMeta = meta === undefined ? undefined : redact(meta);
    this.sink(level, `[${this.namespace}] ${message}`, safeMeta);
  }

  error(message: string, meta?: unknown): void {
    this.emit('error', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.emit('warn', message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.emit('info', message, meta);
  }
  debug(message: string, meta?: unknown): void {
    this.emit('debug', message, meta);
  }
}

/** Default shared logger; level can be reconfigured at startup. */
export const logger = new Logger();
