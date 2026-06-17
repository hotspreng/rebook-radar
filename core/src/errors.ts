/**
 * Typed error hierarchy for airline integration failures.
 *
 * The UI/desktop layer can switch on `code` to present actionable messages
 * (e.g. prompt the user to solve a CAPTCHA in a headful browser).
 */

export type AirlineErrorCode =
  | 'LOGIN_FAILED'
  | 'CAPTCHA_REQUIRED'
  | 'MFA_REQUIRED'
  | 'SITE_CHANGED'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'NO_RESULTS'
  | 'NOT_SUPPORTED'
  | 'UNKNOWN';

export class AirlineError extends Error {
  readonly code: AirlineErrorCode;
  readonly providerId: string;
  readonly cause?: unknown;

  constructor(
    code: AirlineErrorCode,
    message: string,
    options?: { providerId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'AirlineError';
    this.code = code;
    this.providerId = options?.providerId ?? 'unknown';
    this.cause = options?.cause;
  }
}

export class LoginFailedError extends AirlineError {
  constructor(message = 'Login failed. Check the username and password.', providerId?: string, cause?: unknown) {
    super('LOGIN_FAILED', message, { providerId, cause });
    this.name = 'LoginFailedError';
  }
}

export class CaptchaRequiredError extends AirlineError {
  constructor(message = 'A CAPTCHA / human verification challenge was presented.', providerId?: string) {
    super('CAPTCHA_REQUIRED', message, { providerId });
    this.name = 'CaptchaRequiredError';
  }
}

export class MfaRequiredError extends AirlineError {
  constructor(message = 'Multi-factor authentication is required.', providerId?: string) {
    super('MFA_REQUIRED', message, { providerId });
    this.name = 'MfaRequiredError';
  }
}

export class SiteChangedError extends AirlineError {
  constructor(message = 'The airline website layout changed; selectors need updating.', providerId?: string, cause?: unknown) {
    super('SITE_CHANGED', message, { providerId, cause });
    this.name = 'SiteChangedError';
  }
}

export class NoResultsError extends AirlineError {
  constructor(message = 'No matching flights were found.', providerId?: string) {
    super('NO_RESULTS', message, { providerId });
    this.name = 'NoResultsError';
  }
}

export function isAirlineError(err: unknown): err is AirlineError {
  return err instanceof AirlineError;
}
