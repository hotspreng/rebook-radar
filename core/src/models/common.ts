/**
 * Core enums and shared value types.
 *
 * This module is framework-agnostic. It MUST NOT import Electron, Node-only,
 * or browser-only APIs so it can be reused by the desktop shell and a future
 * web client alike.
 */

/** How a booking was paid for. */
export enum PurchaseType {
  Cash = 'cash',
  Points = 'points',
}

/** Southwest fare classes relevant to refundability / rebooking. */
export enum FareType {
  WannaGetAway = 'wanna_get_away',
  WannaGetAwayPlus = 'wanna_get_away_plus',
  Anytime = 'anytime',
  BusinessSelect = 'business_select',
  Unknown = 'unknown',
}

/** The system's recommendation after comparing prices. */
export enum Recommendation {
  Rebook = 'rebook',
  Keep = 'keep',
  /** Not enough data (e.g. current price could not be fetched). */
  Unknown = 'unknown',
}

/** Where a flight record originated. */
export enum FlightSource {
  Manual = 'manual',
  Scraped = 'scraped',
  Email = 'email',
}

/** A monetary amount paired with the unit it is measured in. */
export interface Money {
  /** Amount in whole USD dollars (e.g. 129.98). */
  usd: number;
}

/** A Rapid Rewards points amount. */
export interface PointsAmount {
  points: number;
}

/**
 * The total cost of a booking. Southwest points bookings still incur cash
 * taxes/fees, so we always track both a primary amount and the cash fees.
 */
export interface BookingCost {
  purchaseType: PurchaseType;
  /** Cash fare in USD (present when purchaseType === Cash). */
  cashUsd?: number;
  /** Points spent (present when purchaseType === Points). */
  points?: number;
  /** Taxes & fees paid in cash USD (applies to both cash and points bookings). */
  taxesAndFeesUsd: number;
}

/** ISO-8601 date-time string, e.g. "2026-08-14T09:35:00-05:00". */
export type IsoDateTime = string;
/** ISO-8601 date string, e.g. "2026-08-14". */
export type IsoDate = string;
