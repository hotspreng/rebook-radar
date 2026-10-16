import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAirportCity, formatAirportName, lookupAirport } from './airports.js';

test('every airport in the current trips is spelled out', () => {
  const expected: Record<string, string> = {
    ORD: "Chicago, IL – O'Hare International Airport (ORD)",
    MDW: 'Chicago, IL – Midway International Airport (MDW)',
    EGE: 'Vail/Eagle, CO – Eagle County Regional Airport (EGE)',
    OGG: 'Maui, HI – Kahului Airport (OGG)',
    FLL: 'Fort Lauderdale, FL – Fort Lauderdale–Hollywood International Airport (FLL)',
    ITH: 'Ithaca, NY – Ithaca Tompkins International Airport (ITH)',
    IAD: 'Washington, DC – Dulles International Airport (IAD)',
    SYR: 'Syracuse, NY – Syracuse Hancock International Airport (SYR)',
    ROC: 'Rochester, NY – Frederick Douglass Greater Rochester International Airport (ROC)',
    DEN: 'Denver, CO – Denver International Airport (DEN)',
    MSY: 'New Orleans, LA – Louis Armstrong New Orleans International Airport (MSY)',
    LGA: 'New York, NY – LaGuardia Airport (LGA)',
    PHL: 'Philadelphia, PA – Philadelphia International Airport (PHL)',
    PDX: 'Portland, OR – Portland International Airport (PDX)',
    SEA: 'Seattle, WA – Seattle–Tacoma International Airport (SEA)',
    LHR: 'London, UK – Heathrow Airport (LHR)',
  };
  for (const [code, text] of Object.entries(expected)) {
    assert.equal(formatAirportName(code), text);
  }
});

test('lookup is case- and whitespace-insensitive', () => {
  assert.deepEqual(lookupAirport(' ege '), { city: 'Vail/Eagle, CO', name: 'Eagle County Regional Airport' });
  assert.equal(formatAirportName('ord'), "Chicago, IL – O'Hare International Airport (ORD)");
});

test('an unlisted code falls back to the stored name, then the bare code', () => {
  assert.equal(lookupAirport('ZZZ'), undefined);
  assert.equal(formatAirportName('ZZZ', 'Some Regional'), 'Some Regional (ZZZ)');
  assert.equal(formatAirportName('zzz'), 'ZZZ');
});

test('the short city form is used for layovers', () => {
  assert.equal(formatAirportCity('IAD'), 'Washington, DC (IAD)');
  assert.equal(formatAirportCity('ZZZ', 'Some Regional'), 'Some Regional (ZZZ)');
});
