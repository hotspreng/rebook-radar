import { FareType, IsoDateTime, PurchaseType } from './common.js';

/**
 * One alternative flight option from the same-day search results. Used to show
 * the user cheaper departure times they could rebook into.
 */
export interface FareAlternative {
  flightNumber?: string;
  departureDateTime: IsoDateTime;
  fareType: FareType;
  cashUsd?: number;
  points?: number;
  pointsEstimated?: boolean;
  pointsTaxesAndFeesUsd?: number;
  stops?: number;
}

/**
 * A current price quote for a specific flight option returned by an
 * AirlineProvider. Southwest typically returns both a cash price and a points
 * price for the same flight, so both may be present.
 */
export interface PriceQuote {
  /** Flight this quote corresponds to (matched by route + date). */
  flightId: string;

  fareType: FareType;

  /** Lowest available cash fare in USD for this flight, if available. */
  cashUsd?: number;
  /** Lowest available points price, if available. */
  points?: number;
  /** True when `points` was estimated from the cash fare rather than read directly. */
  pointsEstimated?: boolean;
  /** Taxes & fees in USD for a points booking. */
  pointsTaxesAndFeesUsd?: number;

  /** Origin departure time matched for this quote. */
  departureDateTime: IsoDateTime;

  /** When this quote was fetched. */
  fetchedAt: string;

  /** Which provider produced this quote, e.g. "southwest". */
  providerId: string;

  /** Optional preferred purchase type for the quote (mirrors original booking). */
  preferredPurchaseType?: PurchaseType;

  /**
   * All same-day options from the search, cheapest first, in the original
   * booking's currency. Lets the UI surface cheaper alternative departure times.
   */
  alternatives?: FareAlternative[];
}
