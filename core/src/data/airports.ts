/**
 * Airport lookup: IATA code → city and official airport name.
 *
 * Used to spell out airports in shareable text (e.g. an itinerary), where a
 * bare "EGE" means nothing to the recipient. Covers every airport in current
 * use plus the major US, Canadian and international hubs; a code that is not
 * listed simply falls back to the bare code, so a gap never breaks output.
 * Add entries as new airports appear.
 *
 * Tuple order: [city, airport name].
 */
const AIRPORTS: Record<string, readonly [city: string, name: string]> = {
  // --- Chicago / Midwest -------------------------------------------------
  ORD: ['Chicago, IL', "O'Hare International Airport"],
  MDW: ['Chicago, IL', 'Midway International Airport'],
  MKE: ['Milwaukee, WI', 'Milwaukee Mitchell International Airport'],
  MSN: ['Madison, WI', 'Dane County Regional Airport'],
  MSP: ['Minneapolis, MN', 'Minneapolis–Saint Paul International Airport'],
  DTW: ['Detroit, MI', 'Detroit Metropolitan Wayne County Airport'],
  GRR: ['Grand Rapids, MI', 'Gerald R. Ford International Airport'],
  CLE: ['Cleveland, OH', 'Cleveland Hopkins International Airport'],
  CMH: ['Columbus, OH', 'John Glenn Columbus International Airport'],
  CVG: ['Cincinnati, OH', 'Cincinnati/Northern Kentucky International Airport'],
  DAY: ['Dayton, OH', 'Dayton International Airport'],
  IND: ['Indianapolis, IN', 'Indianapolis International Airport'],
  STL: ['St. Louis, MO', 'St. Louis Lambert International Airport'],
  MCI: ['Kansas City, MO', 'Kansas City International Airport'],
  OMA: ['Omaha, NE', 'Eppley Airfield'],
  DSM: ['Des Moines, IA', 'Des Moines International Airport'],
  ICT: ['Wichita, KS', 'Wichita Dwight D. Eisenhower National Airport'],
  SDF: ['Louisville, KY', 'Louisville Muhammad Ali International Airport'],
  LEX: ['Lexington, KY', 'Blue Grass Airport'],

  // --- Northeast ---------------------------------------------------------
  JFK: ['New York, NY', 'John F. Kennedy International Airport'],
  LGA: ['New York, NY', 'LaGuardia Airport'],
  EWR: ['Newark, NJ', 'Newark Liberty International Airport'],
  HPN: ['White Plains, NY', 'Westchester County Airport'],
  ISP: ['Islip, NY', 'Long Island MacArthur Airport'],
  BUF: ['Buffalo, NY', 'Buffalo Niagara International Airport'],
  ROC: ['Rochester, NY', 'Frederick Douglass Greater Rochester International Airport'],
  SYR: ['Syracuse, NY', 'Syracuse Hancock International Airport'],
  ITH: ['Ithaca, NY', 'Ithaca Tompkins International Airport'],
  ALB: ['Albany, NY', 'Albany International Airport'],
  BGM: ['Binghamton, NY', 'Greater Binghamton Airport'],
  ELM: ['Elmira, NY', 'Elmira Corning Regional Airport'],
  PHL: ['Philadelphia, PA', 'Philadelphia International Airport'],
  PIT: ['Pittsburgh, PA', 'Pittsburgh International Airport'],
  BOS: ['Boston, MA', 'Logan International Airport'],
  BDL: ['Hartford, CT', 'Bradley International Airport'],
  PVD: ['Providence, RI', 'Rhode Island T. F. Green International Airport'],
  MHT: ['Manchester, NH', 'Manchester–Boston Regional Airport'],
  PWM: ['Portland, ME', 'Portland International Jetport'],
  BTV: ['Burlington, VT', 'Burlington International Airport'],

  // --- Mid-Atlantic / Southeast -----------------------------------------
  IAD: ['Washington, DC', 'Dulles International Airport'],
  DCA: ['Washington, DC', 'Ronald Reagan Washington National Airport'],
  BWI: ['Baltimore, MD', 'Baltimore/Washington International Airport'],
  RIC: ['Richmond, VA', 'Richmond International Airport'],
  ORF: ['Norfolk, VA', 'Norfolk International Airport'],
  RDU: ['Raleigh/Durham, NC', 'Raleigh–Durham International Airport'],
  CLT: ['Charlotte, NC', 'Charlotte Douglas International Airport'],
  GSO: ['Greensboro, NC', 'Piedmont Triad International Airport'],
  CHS: ['Charleston, SC', 'Charleston International Airport'],
  CAE: ['Columbia, SC', 'Columbia Metropolitan Airport'],
  GSP: ['Greenville/Spartanburg, SC', 'Greenville–Spartanburg International Airport'],
  SAV: ['Savannah, GA', 'Savannah/Hilton Head International Airport'],
  ATL: ['Atlanta, GA', 'Hartsfield–Jackson Atlanta International Airport'],
  BNA: ['Nashville, TN', 'Nashville International Airport'],
  MEM: ['Memphis, TN', 'Memphis International Airport'],
  BHM: ['Birmingham, AL', 'Birmingham–Shuttlesworth International Airport'],
  MSY: ['New Orleans, LA', 'Louis Armstrong New Orleans International Airport'],
  JAX: ['Jacksonville, FL', 'Jacksonville International Airport'],
  MCO: ['Orlando, FL', 'Orlando International Airport'],
  TPA: ['Tampa, FL', 'Tampa International Airport'],
  MIA: ['Miami, FL', 'Miami International Airport'],
  FLL: ['Fort Lauderdale, FL', 'Fort Lauderdale–Hollywood International Airport'],
  PBI: ['West Palm Beach, FL', 'Palm Beach International Airport'],
  RSW: ['Fort Myers, FL', 'Southwest Florida International Airport'],
  SRQ: ['Sarasota, FL', 'Sarasota–Bradenton International Airport'],
  PNS: ['Pensacola, FL', 'Pensacola International Airport'],
  EYW: ['Key West, FL', 'Key West International Airport'],

  // --- Texas / South-Central --------------------------------------------
  DFW: ['Dallas–Fort Worth, TX', 'Dallas/Fort Worth International Airport'],
  DAL: ['Dallas, TX', 'Dallas Love Field'],
  IAH: ['Houston, TX', 'George Bush Intercontinental Airport'],
  HOU: ['Houston, TX', 'William P. Hobby Airport'],
  AUS: ['Austin, TX', 'Austin–Bergstrom International Airport'],
  SAT: ['San Antonio, TX', 'San Antonio International Airport'],
  ELP: ['El Paso, TX', 'El Paso International Airport'],
  OKC: ['Oklahoma City, OK', 'Will Rogers World Airport'],
  TUL: ['Tulsa, OK', 'Tulsa International Airport'],
  LIT: ['Little Rock, AR', 'Clinton National Airport'],

  // --- Mountain ----------------------------------------------------------
  DEN: ['Denver, CO', 'Denver International Airport'],
  COS: ['Colorado Springs, CO', 'Colorado Springs Airport'],
  EGE: ['Vail/Eagle, CO', 'Eagle County Regional Airport'],
  ASE: ['Aspen, CO', 'Aspen/Pitkin County Airport'],
  HDN: ['Steamboat Springs, CO', 'Yampa Valley Regional Airport'],
  MTJ: ['Montrose, CO', 'Montrose Regional Airport'],
  GJT: ['Grand Junction, CO', 'Grand Junction Regional Airport'],
  SLC: ['Salt Lake City, UT', 'Salt Lake City International Airport'],
  ABQ: ['Albuquerque, NM', 'Albuquerque International Sunport'],
  PHX: ['Phoenix, AZ', 'Phoenix Sky Harbor International Airport'],
  TUS: ['Tucson, AZ', 'Tucson International Airport'],
  LAS: ['Las Vegas, NV', 'Harry Reid International Airport'],
  RNO: ['Reno, NV', 'Reno–Tahoe International Airport'],
  BOI: ['Boise, ID', 'Boise Airport'],
  SUN: ['Sun Valley, ID', 'Friedman Memorial Airport'],
  BZN: ['Bozeman, MT', 'Bozeman Yellowstone International Airport'],
  JAC: ['Jackson Hole, WY', 'Jackson Hole Airport'],

  // --- West Coast / Pacific ---------------------------------------------
  LAX: ['Los Angeles, CA', 'Los Angeles International Airport'],
  BUR: ['Burbank, CA', 'Hollywood Burbank Airport'],
  ONT: ['Ontario, CA', 'Ontario International Airport'],
  SNA: ['Orange County, CA', 'John Wayne Airport'],
  LGB: ['Long Beach, CA', 'Long Beach Airport'],
  SAN: ['San Diego, CA', 'San Diego International Airport'],
  PSP: ['Palm Springs, CA', 'Palm Springs International Airport'],
  SBA: ['Santa Barbara, CA', 'Santa Barbara Airport'],
  SFO: ['San Francisco, CA', 'San Francisco International Airport'],
  OAK: ['Oakland, CA', 'Oakland International Airport'],
  SJC: ['San Jose, CA', 'Norman Y. Mineta San José International Airport'],
  SMF: ['Sacramento, CA', 'Sacramento International Airport'],
  FAT: ['Fresno, CA', 'Fresno Yosemite International Airport'],
  MRY: ['Monterey, CA', 'Monterey Regional Airport'],
  PDX: ['Portland, OR', 'Portland International Airport'],
  SEA: ['Seattle, WA', 'Seattle–Tacoma International Airport'],
  GEG: ['Spokane, WA', 'Spokane International Airport'],
  ANC: ['Anchorage, AK', 'Ted Stevens Anchorage International Airport'],
  HNL: ['Honolulu, HI', 'Daniel K. Inouye International Airport'],
  OGG: ['Maui, HI', 'Kahului Airport'],
  KOA: ['Kona, HI', 'Ellison Onizuka Kona International Airport'],
  LIH: ['Kauai, HI', 'Lihue Airport'],
  ITO: ['Hilo, HI', 'Hilo International Airport'],

  // --- Canada ------------------------------------------------------------
  YYZ: ['Toronto, ON', 'Toronto Pearson International Airport'],
  YTZ: ['Toronto, ON', 'Billy Bishop Toronto City Airport'],
  YUL: ['Montréal, QC', 'Montréal–Trudeau International Airport'],
  YOW: ['Ottawa, ON', 'Ottawa Macdonald–Cartier International Airport'],
  YQB: ['Québec City, QC', 'Québec City Jean Lesage International Airport'],
  YHZ: ['Halifax, NS', 'Halifax Stanfield International Airport'],
  YWG: ['Winnipeg, MB', 'Winnipeg James Armstrong Richardson International Airport'],
  YYC: ['Calgary, AB', 'Calgary International Airport'],
  YEG: ['Edmonton, AB', 'Edmonton International Airport'],
  YVR: ['Vancouver, BC', 'Vancouver International Airport'],

  // --- Mexico / Caribbean / Latin America -------------------------------
  MEX: ['Mexico City, Mexico', 'Benito Juárez International Airport'],
  CUN: ['Cancún, Mexico', 'Cancún International Airport'],
  SJD: ['Los Cabos, Mexico', 'Los Cabos International Airport'],
  PVR: ['Puerto Vallarta, Mexico', 'Licenciado Gustavo Díaz Ordaz International Airport'],
  SJU: ['San Juan, Puerto Rico', 'Luis Muñoz Marín International Airport'],
  NAS: ['Nassau, Bahamas', 'Lynden Pindling International Airport'],
  MBJ: ['Montego Bay, Jamaica', 'Sangster International Airport'],
  PUJ: ['Punta Cana, Dominican Republic', 'Punta Cana International Airport'],
  SJO: ['San José, Costa Rica', 'Juan Santamaría International Airport'],
  LIR: ['Liberia, Costa Rica', 'Daniel Oduber Quirós International Airport'],
  PTY: ['Panama City, Panama', 'Tocumen International Airport'],
  BOG: ['Bogotá, Colombia', 'El Dorado International Airport'],
  GRU: ['São Paulo, Brazil', 'São Paulo/Guarulhos International Airport'],
  EZE: ['Buenos Aires, Argentina', 'Ministro Pistarini International Airport'],

  // --- Europe ------------------------------------------------------------
  LHR: ['London, UK', 'Heathrow Airport'],
  LGW: ['London, UK', 'Gatwick Airport'],
  DUB: ['Dublin, Ireland', 'Dublin Airport'],
  CDG: ['Paris, France', 'Charles de Gaulle Airport'],
  AMS: ['Amsterdam, Netherlands', 'Amsterdam Airport Schiphol'],
  FRA: ['Frankfurt, Germany', 'Frankfurt Airport'],
  MUC: ['Munich, Germany', 'Munich Airport'],
  ZRH: ['Zurich, Switzerland', 'Zurich Airport'],
  MAD: ['Madrid, Spain', 'Adolfo Suárez Madrid–Barajas Airport'],
  BCN: ['Barcelona, Spain', 'Josep Tarradellas Barcelona–El Prat Airport'],
  FCO: ['Rome, Italy', 'Leonardo da Vinci–Fiumicino Airport'],
  KEF: ['Reykjavík, Iceland', 'Keflavík International Airport'],

  // --- Asia / Pacific ----------------------------------------------------
  HND: ['Tokyo, Japan', 'Haneda Airport'],
  NRT: ['Tokyo, Japan', 'Narita International Airport'],
  ICN: ['Seoul, South Korea', 'Incheon International Airport'],
  PEK: ['Beijing, China', 'Beijing Capital International Airport'],
  PVG: ['Shanghai, China', 'Shanghai Pudong International Airport'],
  HKG: ['Hong Kong', 'Hong Kong International Airport'],
  SIN: ['Singapore', 'Singapore Changi Airport'],
  SYD: ['Sydney, Australia', 'Sydney Kingsford Smith Airport'],
};

/** City and official name for an IATA code, or `undefined` when not listed. */
export function lookupAirport(code: string): { city: string; name: string } | undefined {
  const entry = AIRPORTS[code.trim().toUpperCase()];
  return entry ? { city: entry[0], name: entry[1] } : undefined;
}

/**
 * Fully spelled-out airport, code in parentheses after:
 * "Chicago, IL – O'Hare International Airport (ORD)". An unlisted code falls
 * back to `fallbackName` ("Some Airport (XYZ)") and finally to the bare code.
 */
export function formatAirportName(code: string, fallbackName?: string): string {
  const upper = code.trim().toUpperCase();
  const known = lookupAirport(upper);
  if (known) return `${known.city} – ${known.name} (${upper})`;
  return fallbackName ? `${fallbackName} (${upper})` : upper;
}

/** Short form for tight spots such as a layover: "Washington, DC (IAD)". */
export function formatAirportCity(code: string, fallbackName?: string): string {
  const upper = code.trim().toUpperCase();
  const known = lookupAirport(upper);
  if (known) return `${known.city} (${upper})`;
  return fallbackName ? `${fallbackName} (${upper})` : upper;
}
