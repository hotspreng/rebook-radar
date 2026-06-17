import { AccountCredentials } from '../models/Account.js';
import { FlightSearchQuery } from './AirlineProvider.js';
import {
  RawFareOption,
  RawTrip,
  SouthwestClientSession,
  SouthwestScraperClient,
} from './SouthwestScraperClient.js';

/**
 * In-memory fake of {@link SouthwestScraperClient} for development, demos, and
 * unit tests. Returns deterministic data and performs no network access.
 *
 * The desktop app uses this automatically when real scraping is disabled, so
 * the full UI/pricing pipeline can be exercised without logging into Southwest.
 */
export class FakeSouthwestScraperClient implements SouthwestScraperClient {
  async login(
    _credentials: AccountCredentials,
    accountId: string,
  ): Promise<{ session: SouthwestClientSession; pageText: string }> {
    return {
      session: { accountId, handle: { fake: true } },
      pageText: 'Welcome back! My Trips',
    };
  }

  async fetchTrips(
    _session: SouthwestClientSession,
  ): Promise<{ trips: RawTrip[]; pageText: string }> {
    const trips: RawTrip[] = [
      {
        confirmationNumber: 'DEMO12',
        passengerNames: ['Demo Traveler'],
        origin: 'MDW',
        destination: 'DEN',
        departureDateTime: '2026-08-14T09:35:00-05:00',
        arrivalDateTime: '2026-08-14T11:05:00-06:00',
        fareLabel: 'Wanna Get Away',
        pointsText: '12,000 pts',
        taxesText: '$5.60',
      },
    ];
    return { trips, pageText: 'My Trips' };
  }

  async searchFlights(
    query: FlightSearchQuery,
    _session?: SouthwestClientSession,
  ): Promise<{ options: RawFareOption[]; pageText: string }> {
    // Simulate a price drop so the demo shows a "Rebook" recommendation.
    const options: RawFareOption[] = [
      {
        flightNumber: 'WN 2468',
        departureDateTime: `${query.departureDate}T09:35:00-05:00`,
        arrivalDateTime: `${query.departureDate}T11:05:00-06:00`,
        fareLabel: 'Wanna Get Away',
        cashText: '$118.00',
        pointsText: '8,200 pts',
        taxesText: '$5.60',
        stops: 0,
      },
      {
        flightNumber: 'WN 1357',
        departureDateTime: `${query.departureDate}T14:10:00-05:00`,
        arrivalDateTime: `${query.departureDate}T15:40:00-06:00`,
        fareLabel: 'Wanna Get Away Plus',
        cashText: '$142.00',
        pointsText: '10,100 pts',
        taxesText: '$5.60',
        stops: 0,
      },
    ];
    return { options, pageText: 'Select your flight' };
  }

  async close(_session: SouthwestClientSession): Promise<void> {
    // no-op
  }
}
