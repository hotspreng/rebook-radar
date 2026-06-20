import type { JsonFetch } from './GoogleFlightsSerpApiProvider.js';

/** SerpApi account / quota usage for a single key. */
export interface SerpApiAccountUsage {
  /** Searches included in the plan each month (e.g. 250 for the free plan). */
  searchesPerMonth?: number;
  /** Searches already consumed this month. */
  thisMonthUsage?: number;
  /** Plan searches remaining this month. */
  planSearchesLeft?: number;
  /** Plan searches + any extra credits remaining. */
  totalSearchesLeft?: number;
  /** Account email, when returned. */
  accountEmail?: string;
}

interface SerpAccountResponse {
  error?: string;
  account_email?: string;
  searches_per_month?: number;
  plan_searches_left?: number;
  total_searches_left?: number;
  this_month_usage?: number;
}

/**
 * Queries SerpApi's free Account API for the given key's monthly usage.
 *
 * The Account API does not count toward the monthly search quota. Throws when
 * the response carries an `error` payload (e.g. an invalid key).
 */
export async function fetchSerpApiUsage(
  fetchJson: JsonFetch,
  apiKey: string,
  baseUrl = 'https://serpapi.com/account.json',
): Promise<SerpApiAccountUsage> {
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}`;
  const body = ((await fetchJson(url)) ?? {}) as SerpAccountResponse;
  if (body.error) {
    throw new Error(body.error);
  }
  return {
    searchesPerMonth: body.searches_per_month,
    thisMonthUsage: body.this_month_usage,
    planSearchesLeft: body.plan_searches_left,
    totalSearchesLeft: body.total_searches_left,
    accountEmail: body.account_email,
  };
}
