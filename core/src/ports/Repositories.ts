import { Account } from '../models/Account.js';
import { Flight } from '../models/Flight.js';
import { Passenger } from '../models/Passenger.js';
import { PriceComparison } from '../models/PriceComparison.js';
import { PriceQuote } from '../models/PriceQuote.js';

/**
 * Persistence "ports" (hexagonal architecture). Core defines WHAT it needs from
 * storage; the desktop layer provides a SQLite-backed adapter and a future web
 * host could provide an HTTP/IndexedDB-backed one. Core never imports a DB.
 */

export interface PassengerRepository {
  list(): Promise<Passenger[]>;
  get(id: string): Promise<Passenger | undefined>;
  create(passenger: Passenger): Promise<Passenger>;
  update(passenger: Passenger): Promise<Passenger>;
  delete(id: string): Promise<void>;
}

export interface AccountRepository {
  list(): Promise<Account[]>;
  get(id: string): Promise<Account | undefined>;
  create(account: Account): Promise<Account>;
  update(account: Account): Promise<Account>;
  delete(id: string): Promise<void>;
}

export interface FlightRepository {
  list(): Promise<Flight[]>;
  listByPassenger(passengerId: string): Promise<Flight[]>;
  listByAccount(accountId: string): Promise<Flight[]>;
  listMonitored(): Promise<Flight[]>;
  get(id: string): Promise<Flight | undefined>;
  create(flight: Flight): Promise<Flight>;
  update(flight: Flight): Promise<Flight>;
  delete(id: string): Promise<void>;
}

export interface QuoteRepository {
  /** Upsert the latest quote and comparison for a flight. */
  saveLatest(flightId: string, quote: PriceQuote | undefined, comparison: PriceComparison): Promise<void>;
  getLatest(flightId: string): Promise<{ quote?: PriceQuote; comparison?: PriceComparison } | undefined>;
}

/**
 * Secure secret storage port. Implemented by the desktop layer using Windows
 * Credential Manager / DPAPI. Core only ever sees this narrow interface and
 * never the underlying secrets at rest.
 */
export interface SecretStore {
  setPassword(account: string, password: string): Promise<void>;
  getPassword(account: string): Promise<string | undefined>;
  deletePassword(account: string): Promise<void>;
}
