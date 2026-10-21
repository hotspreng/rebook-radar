import {
  Airline,
  BookingCost,
  Cabin,
  FareType,
  FlightSource,
  IsoDate,
  IsoDateTime,
  PurchaseType,
} from './common.js';

/** A single airport in a route. */
export interface Airport {
  /** IATA code, e.g. "MDW". */
  code: string;
  /** Human readable name, optional. */
  name?: string;
}

/** Origin/destination pair. */
export interface Route {
  origin: Airport;
  destination: Airport;
}

/**
 * One operated segment within a single direction of travel.
 *
 * A direction with a connection (e.g. MDW → ATL → MSY) is made up of multiple
 * segments. A non-stop direction has a single segment matching the route.
 */
export interface FlightSegment {
  origin: Airport;
  destination: Airport;
  /** Departure date/time in the segment origin's local time zone (ISO-8601). */
  departureDateTime: IsoDateTime;
  /** Arrival date/time at the segment destination, when known. */
  arrivalDateTime?: IsoDateTime;
  /** Marketing flight number, e.g. "WN 2886". */
  flightNumber?: string;
}

/**
 * A tracked Southwest flight (one direction of travel).
 *
 * A round trip is represented as two `Flight` records sharing a confirmation
 * number, which mirrors how Southwest prices and refunds each leg separately.
 */
export interface Flight {
  id: string;

  /** Passenger this flight belongs to. */
  passengerId: string;
  /** Account the flight was booked under, when known. */
  accountId?: string;

  /** Airline this flight is booked on. Defaults to Southwest for legacy data. */
  airline: Airline;

  confirmationNumber: string;
  /**
   * The operating partner's own booking reference when this booking was made
   * through a different airline's program (e.g. the "United Airlines booking
   * reference" on an Air Canada/Aeroplan confirmation). Distinct from
   * {@link confirmationNumber}, which is the booking program's own code.
   */
  partnerConfirmationNumber?: string;
  route: Route;
  /** Departure date/time in the origin's local time zone (ISO-8601). */
  departureDateTime: IsoDateTime;
  /** Arrival date/time, when known. */
  arrivalDateTime?: IsoDateTime;
  /** Total scheduled travel time in minutes, when known. */
  durationMinutes?: number;

  /** Operated segments for this direction, including a single one for a nonstop. */
  segments?: FlightSegment[];

  fareType: FareType;

  /**
   * Cabin / class of service (Basic Economy, Main Cabin, Comfort+, etc.).
   * Populated for carriers that expose it (Delta, United); undefined for
   * Southwest, whose product is captured by {@link fareType} instead.
   */
  cabin?: Cabin;

  /** What was originally paid for this flight. */
  originalCost: BookingCost;
  /**
   * Actual market cash fare observed via a price check near the time of
   * booking, when captured. Lets the UI show a real ("actual") cash value for
   * a points booking instead of a points-to-cash estimate.
   */
  originalMarketCashUsd?: number;
  /** Date the booking was made. */
  bookingDate: IsoDate;

  /** Where this record came from (manual entry vs scraping). */
  source: FlightSource;

  /** Optional free-text note. */
  notes?: string;

  /** Whether the flight is actively monitored for price drops. */
  monitoring: boolean;

  createdAt: string;
  updatedAt: string;
}

export type NewFlight = Omit<Flight, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Known marketing-carrier flight-number prefixes mapped to their {@link
 * Airline}. Used only to infer the carrier actually OPERATING a flight when
 * it differs from the program the booking was made through — see {@link
 * operatingAirline}. Extend this as other loyalty-program bookings on
 * partner-operated flights are discovered.
 */
const FLIGHT_NUMBER_PREFIX_AIRLINE: Partial<Record<string, Airline>> = {
  UA: Airline.United,
};

/**
 * The airline actually operating/marketing a flight, for DISPLAY purposes.
 *
 * `Flight.airline` records which loyalty program/account a booking was made
 * through — needed for point valuation (an Aeroplan mile is worth what
 * Aeroplan redemptions are worth, regardless of which airline flies the
 * route) and for picking the right fare-search filter. But Aeroplan
 * (Air Canada's program) frequently redeems for a PARTNER-operated flight —
 * e.g. a United-operated, United-numbered flight booked through Air Canada —
 * so showing "Air Canada" as the flight's airline is misleading to the user.
 *
 * This derives the operating carrier from the first segment's flight-number
 * prefix when it disagrees with the stored `airline`, falling back to the
 * stored value when there is no segment data or no recognized prefix (so a
 * genuine Air Canada-operated flight still shows as Air Canada).
 */
export function operatingAirline(flight: Flight): Airline {
  if (flight.airline !== Airline.AirCanada) return flight.airline;
  const prefix = flight.segments?.[0]?.flightNumber?.match(/^([A-Z0-9]{2})\b/i)?.[1]?.toUpperCase();
  return (prefix && FLIGHT_NUMBER_PREFIX_AIRLINE[prefix]) || flight.airline;
}

/** Southwest cash tickets below this all-in total are Companion Pass tickets (taxes only). */
export const COMPANION_PASS_MAX_USD = 20;

/**
 * Whether a flight is assumed to be a Southwest Companion Pass ticket: a cash
 * booking so cheap (under $20 all-in) that only taxes and fees were paid. Such
 * tickets have no fare to compare against the market, so price, savings and
 * rebooking don't apply to them.
 */
export function isCompanionPassFlight(flight: Flight): boolean {
  if (flight.airline !== Airline.Southwest) return false;
  if (flight.originalCost.purchaseType !== PurchaseType.Cash) return false;
  const cash = flight.originalCost.cashUsd;
  if (cash == null) return false;
  // Manual entries keep the base fare and taxes separately; email imports store the grand total.
  const total = cash + (flight.source === FlightSource.Manual ? flight.originalCost.taxesAndFeesUsd : 0);
  return total < COMPANION_PASS_MAX_USD;
}
