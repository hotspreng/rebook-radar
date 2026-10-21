/**
 * Known bus stops, keyed by the station name a bus company prints on its
 * confirmation. FlixBus emails give only a bare station ("Ithaca",
 * "Rochester Bus Stop"), so the street address and how to find the stop come
 * from here. Add an entry whenever a new station shows up.
 */
export interface BusStopInfo {
  provider: 'flixbus';
  /** Matches the station name exactly as printed in the email (case-insensitive). */
  station: RegExp;
  /** "Ithaca, NY" — the city with its state. */
  city: string;
  /** Address and boarding directions, as they should read in an itinerary. */
  stop: string;
}

export const BUS_STOPS: BusStopInfo[] = [
  {
    provider: 'flixbus',
    station: /^ithaca$/i,
    city: 'Ithaca, NY',
    stop:
      '131 E Green St, Ithaca, NY 14850 (curbside in front of Urban Outfitters; do not wait inside the Tompkins County Public Library)',
  },
  {
    provider: 'flixbus',
    station: /^rochester(?: bus stop)?$/i,
    city: 'Rochester, NY',
    stop: '120–124 Pleasant St, Rochester, NY 14604 (on Pleasant Street near the RTS Transit Center)',
  },
];

export function lookupBusStop(provider: BusStopInfo['provider'], station: string): BusStopInfo | undefined {
  const name = station.replace(/\s+/g, ' ').trim();
  return BUS_STOPS.find((s) => s.provider === provider && s.station.test(name));
}
