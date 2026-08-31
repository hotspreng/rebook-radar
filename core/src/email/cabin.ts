import { Cabin } from '../models/common.js';

/**
 * Map a free-text cabin / class-of-service label (as printed in an airline
 * confirmation email) onto a {@link Cabin}. Airline-agnostic: understands the
 * common Delta and United labels. Order matters — more specific phrases (e.g.
 * "Basic Economy", "Premium Economy") are tested before their broader parents.
 */
export function normalizeCabin(label: string | null | undefined): Cabin {
  if (!label) return Cabin.Unknown;
  const l = label.toLowerCase();
  if (l.includes('basic economy')) return Cabin.BasicEconomy;
  if (l.includes('polaris') || l.includes('delta one') || l.includes('business')) {
    return Cabin.Business;
  }
  if (
    l.includes('premium plus') ||
    l.includes('premium select') ||
    l.includes('premium economy') ||
    l.includes('comfort')
  ) {
    return Cabin.PremiumEconomy;
  }
  if (l.includes('first')) return Cabin.First;
  if (l.includes('main') || l.includes('economy') || l.includes('coach')) return Cabin.Economy;
  return Cabin.Unknown;
}
