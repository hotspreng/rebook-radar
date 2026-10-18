/** Which bus company issued a ticket. */
export type BusProvider = 'ourbus';

export const BUS_PROVIDER_LABELS: Record<BusProvider, string> = {
  ourbus: 'OurBus',
};

/**
 * One imported bus ticket: a single ride from a boarding stop to a final stop,
 * typically the transfer to or from an airport.
 *
 * Times are wall-clock at each stop and carry no timezone:
 * `YYYY-MM-DDTHH:mm:00`.
 */
export interface BusRide {
  id: string;
  provider: BusProvider;
  /** The company's ticket reference code. */
  ticketReference: string;
  departureAt: string;
  arrivalAt: string;
  /** "Ithaca, NY" */
  departureCity: string;
  /** Where to board, as the ticket words it. */
  departureStop?: string;
  arrivalCity: string;
  arrivalStop?: string;
  /** "Motor Coach" */
  vehicle?: string;
  /** The company actually running the bus (it can change after booking). */
  operator?: string;
  passengerNames: string[];
  /** Gmail message the ticket was last parsed from. */
  emailId?: string;
  /** When that email arrived (ISO timestamp). */
  bookedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A ride as parsed from email, before it is assigned an id or timestamps. */
export type ParsedBusRide = Omit<BusRide, 'id' | 'createdAt' | 'updatedAt'>;

/** Stable identity for de-duplicating re-imports: the ticket reference code. */
export function busRideKey(ride: Pick<BusRide, 'provider' | 'ticketReference'>): string {
  return `${ride.provider}|${ride.ticketReference.trim().toUpperCase()}`;
}

const AIRPORT_WORD = /\bairport\b/i;

/**
 * Whether the ride takes you to an airport (`'to'`), brings you from one
 * (`'from'`), or neither/unknown. Read from the stop names, e.g. "Syracuse
 * Airport, NY" or "Greater Rochester International Airport, arrivals…".
 */
export function busAirportDirection(
  ride: Pick<BusRide, 'departureCity' | 'departureStop' | 'arrivalCity' | 'arrivalStop'>,
): 'to' | 'from' | undefined {
  const fromAirport = AIRPORT_WORD.test(`${ride.departureCity} ${ride.departureStop ?? ''}`);
  const toAirport = AIRPORT_WORD.test(`${ride.arrivalCity} ${ride.arrivalStop ?? ''}`);
  if (toAirport && !fromAirport) return 'to';
  if (fromAirport && !toAirport) return 'from';
  return undefined;
}
