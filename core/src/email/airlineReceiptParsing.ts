import { AIRLINE_LABELS, Airline, PurchaseType } from '../models/common.js';
import { EmailMessage } from './EmailMessage.js';
import { isAirCanadaEmail, parseAirCanadaEmail } from './airCanadaEmailParsing.js';
import { isAmericanEmail, parseAmericanEmail } from './americanEmailParsing.js';
import { isDeltaEmail, parseDeltaEmail } from './deltaEmailParsing.js';
import { isSouthwestEmail, parseSouthwestEmail } from './southwestEmailParsing.js';
import { isUnitedEmail, parseUnitedEmail } from './unitedEmailParsing.js';
import { ParsedTripEvent } from './TripEvent.js';

/** Expense-shaped data extracted from an airline confirmation email. */
export interface AirlineReceipt {
  airline: Airline;
  merchant: string;
  description: string;
  confirmationNumber: string;
  transactionDate: string;
  cashPaidUsd: number;
  pointsRedeemed?: number;
  origin: string;
  destination: string;
}

/**
 * Convert a supported airline confirmation into one expense transaction.
 * Cash bookings use the reservation total; award bookings include only cash
 * taxes/fees, never the redeemed points' dollar value.
 */
export function parseAirlineReceipt(message: EmailMessage): AirlineReceipt | undefined {
  const event = parseAirlineEvent(message);
  const trip = event?.trip;
  if (!event || !trip?.airline || !trip.origin || !trip.destination) return undefined;

  const cashPaidUsd =
    parseReservationCashTotal(trip.airline, message.body ?? '') ??
    (trip.purchaseType === PurchaseType.Points ? trip.taxesAndFeesUsd : trip.paidCashUsd);
  if (cashPaidUsd == null || !Number.isFinite(cashPaidUsd) || cashPaidUsd <= 0) return undefined;

  return {
    airline: trip.airline,
    merchant: trip.airline === Airline.American ? 'American Airlines' : AIRLINE_LABELS[trip.airline],
    description: `Airfare ${trip.origin} to ${trip.destination}`,
    confirmationNumber: event.confirmationNumber,
    transactionDate: new Date(message.internalDate).toISOString().slice(0, 10),
    cashPaidUsd: round2(cashPaidUsd),
    pointsRedeemed: trip.purchaseType === PurchaseType.Points ? trip.paidPoints : undefined,
    origin: trip.origin,
    destination: trip.destination,
  };
}

function parseAirlineEvent(message: EmailMessage): ParsedTripEvent | undefined {
  const senderText = `${message.from ?? ''}\n${message.body ?? ''}`;
  if (isAirCanadaEmail(senderText)) return parseAirCanadaEmail(message);
  if (isUnitedEmail(senderText)) return parseUnitedEmail(message);
  if (isDeltaEmail(senderText)) return parseDeltaEmail(message);
  if (isAmericanEmail(senderText)) return parseAmericanEmail(message);
  if (isSouthwestEmail(senderText)) return parseSouthwestEmail(message);
  return undefined;
}

function parseReservationCashTotal(airline: Airline, body: string): number | undefined {
  let match: RegExpMatchArray | null = null;
  switch (airline) {
    case Airline.American:
      match = body.match(/Total paid\s*\$\s*([\d,]+\.\d{2})/i);
      break;
    case Airline.Delta:
      match = body.match(/Total Charged\s*[-:\s]*(?:&#36;|\$)\s*([\d,]+\.\d{2})\s*USD/i);
      break;
    case Airline.United: {
      return parseUnitedCashTotal(body);
    }
    case Airline.Southwest:
      match = body.match(
        /\b(?:grand total|total cost|total|amount (?:paid|charged))\b[^$]{0,20}\$\s*([\d,]+\.\d{2})/i,
      );
      break;
    case Airline.AirCanada:
      return undefined;
  }
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function parseUnitedCashTotal(body: string): number | undefined {
  const cardPayment = body.match(/Credit card payment:\s*\$?\s*([\d,]+\.\d{2})/i);
  if (cardPayment) return parseUsd(cardPayment[1]);

  const purchaseRegion = body.split(/\bFare Rules\b/i, 1)[0] ?? body;
  const totals = Array.from(
    purchaseRegion.matchAll(/(?:^|\n)\s*Total:\s*\$?\s*([\d,]+\.\d{2})(?:\s*USD)?/gim),
    (total) => parseUsd(total[1]),
  ).filter((total): total is number => total != null);
  if (totals.length === 0) return undefined;
  return round2(totals.reduce((sum, total) => sum + total, 0));
}

function parseUsd(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}