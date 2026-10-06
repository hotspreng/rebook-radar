import { Airline } from './common.js';

/** Lifecycle of a credit review item. */
export type CreditReviewStatus = 'pending' | 'applied' | 'dismissed';

/**
 * A pending "which leg did this credit apply to?" item.
 *
 * Some airlines (United) email a single points/cash redeposit for a voluntary
 * change without saying which direction of a multi-leg booking it applied to.
 * The importer cannot attribute the credit automatically, so it records a
 * `CreditReviewItem` that the user resolves on the Review queue by picking the
 * affected flight — which then records a realized saving on that leg.
 */
export interface CreditReviewItem {
  id: string;

  airline: Airline;
  /** Confirmation number (PNR) the credit applies to. */
  confirmationNumber: string;
  /** Source email id — the dedupe key so re-imports never double-queue. */
  emailId: string;
  /** When the credit email arrived (ISO timestamp). */
  emailDate: string;
  /** Email subject, for display. */
  subject?: string;

  /** Passenger the booking belongs to, when resolved from the tracked legs. */
  passengerId?: string;
  /** Traveler name parsed from the email, for display. */
  passengerName?: string;

  /** Miles/points redeposited, when the credit is in points. */
  creditedPoints?: number;
  /** Cash refunded in USD, when the credit is in cash. */
  creditedCashUsd?: number;

  status: CreditReviewStatus;
  /** Flight the credit was applied to, once resolved. */
  appliedFlightId?: string;

  createdAt: string;
  /** When the item was applied or dismissed (ISO timestamp). */
  resolvedAt?: string;
}
