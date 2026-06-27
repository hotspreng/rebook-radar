import {
  Airline,
  BookingCost,
  FareType,
  FlightSource,
  IsoDate,
  IsoDateTime,
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
  route: Route;
  /** Departure date/time in the origin's local time zone (ISO-8601). */
  departureDateTime: IsoDateTime;
  /** Arrival date/time, when known. */
  arrivalDateTime?: IsoDateTime;
  /** Total scheduled travel time in minutes, when known. */
  durationMinutes?: number;

  /** Operated segments for this direction (present when there is a connection). */
  segments?: FlightSegment[];

  fareType: FareType;

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
