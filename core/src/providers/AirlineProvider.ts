import { AccountCredentials } from '../models/Account.js';
import { FareType, IsoDate, PaymentMethod, PurchaseType } from '../models/common.js';

/** One operated segment within a retrieved direction (between connections). */
export interface RetrievedFlightSegment {
  origin: string;
  destination: string;
  originName?: string;
  destinationName?: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  /** Marketing flight number, e.g. "WN 2886". */
  flightNumber?: string;
}

/** A trip retrieved from an airline account ("My Trips"). */
export interface RetrievedTrip {
  confirmationNumber: string;
  passengerNames: string[];
  origin: string;
  destination: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  /** Total travel time in minutes for this leg, when known. */
  durationMinutes?: number;
  fareType: FareType;
  /** What was paid, when the site exposes it. */
  purchaseType?: PurchaseType;
  paidCashUsd?: number;
  paidPoints?: number;
  taxesAndFeesUsd?: number;
  /** Operated segments for this direction (present when there is a connection). */
  segments?: RetrievedFlightSegment[];
  /** How the booking was funded (credits, vouchers, points, card), when known. */
  payments?: PaymentMethod[];
  /**
   * Individual flight legs when a single confirmation covers more than one
   * direction (e.g. a round trip). The top-level fields mirror the first leg
   * for backward compatibility; when `legs` has 2+ entries the importer creates
   * one tracked flight per leg, all sharing the confirmation number.
   */
  legs?: RetrievedTripLeg[];
}

/** One flown direction within a {@link RetrievedTrip}. */
export interface RetrievedTripLeg {
  origin: string;
  destination: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  /** Total travel time in minutes, when known. */
  durationMinutes?: number;
  /** Operated segments for this direction (present when there is a connection). */
  segments?: RetrievedFlightSegment[];
}

/** Parameters for a one-way price search. */
export interface FlightSearchQuery {
  origin: string;
  destination: string;
  departureDate: IsoDate;
  passengers?: number;
  /** Which price the caller cares about; providers may return both anyway. */
  preferred?: PurchaseType;
}

/** A single priced flight option returned by a search. */
export interface FlightSearchResult {
  flightNumber?: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  fareType: FareType;
  cashUsd?: number;
  points?: number;
  /** True when `points` was estimated from the cash fare, not read from the site. */
  pointsEstimated?: boolean;
  pointsTaxesAndFeesUsd?: number;
  /** Number of stops; 0 = nonstop. */
  stops?: number;
  /** Total travel time in minutes (handles timezone changes). */
  durationMinutes?: number;
}

/** Opaque session token returned after a successful login. */
export interface AirlineSession {
  providerId: string;
  accountId: string;
  /** Implementation-defined handle (e.g. a browser context id). Never logged. */
  handle: unknown;
  createdAt: string;
}

/**
 * Pluggable airline integration contract.
 *
 * Implementations (e.g. SouthwestProvider) encapsulate ALL site-specific logic.
 * The rest of the app depends only on this interface, enabling alternative
 * data sources and easy testing via fakes.
 */
export interface AirlineProvider {
  /** Stable identifier, e.g. "southwest". */
  readonly id: string;
  /** Display name, e.g. "Southwest Airlines". */
  readonly name: string;

  /** Authenticate. Throws typed AirlineError subclasses on failure. */
  login(credentials: AccountCredentials, accountId: string): Promise<AirlineSession>;

  /** Retrieve upcoming trips from "My Trips". */
  getUpcomingTrips(session: AirlineSession): Promise<RetrievedTrip[]>;

  /** Search current pricing for a one-way flight. */
  searchPrice(
    query: FlightSearchQuery,
    session?: AirlineSession,
  ): Promise<FlightSearchResult[]>;

  /** Release any resources held by a session. */
  logout(session: AirlineSession): Promise<void>;
}
