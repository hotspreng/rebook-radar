import type { Airline, CreditReviewItem, CreditReviewRepository, CreditReviewStatus } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface CreditReviewRow {
  id: string;
  airline: string;
  confirmation_number: string;
  email_id: string;
  email_date: string;
  subject: string | null;
  passenger_id: string | null;
  passenger_name: string | null;
  credited_points: number | null;
  credited_cash_usd: number | null;
  status: string;
  applied_flight_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

function toDomain(row: CreditReviewRow): CreditReviewItem {
  return {
    id: row.id,
    airline: row.airline as Airline,
    confirmationNumber: row.confirmation_number,
    emailId: row.email_id,
    emailDate: row.email_date,
    subject: row.subject ?? undefined,
    passengerId: row.passenger_id ?? undefined,
    passengerName: row.passenger_name ?? undefined,
    creditedPoints: row.credited_points ?? undefined,
    creditedCashUsd: row.credited_cash_usd ?? undefined,
    status: row.status as CreditReviewStatus,
    appliedFlightId: row.applied_flight_id ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function bindParams(item: CreditReviewItem): Record<string, unknown> {
  return {
    ':id': item.id,
    ':airline': item.airline,
    ':confirmation_number': item.confirmationNumber,
    ':email_id': item.emailId,
    ':email_date': item.emailDate,
    ':subject': item.subject ?? null,
    ':passenger_id': item.passengerId ?? null,
    ':passenger_name': item.passengerName ?? null,
    ':credited_points': item.creditedPoints ?? null,
    ':credited_cash_usd': item.creditedCashUsd ?? null,
    ':status': item.status,
    ':applied_flight_id': item.appliedFlightId ?? null,
    ':created_at': item.createdAt,
    ':resolved_at': item.resolvedAt ?? null,
  };
}

export class SqliteCreditReviewRepository implements CreditReviewRepository {
  async append(item: CreditReviewItem): Promise<void> {
    execute(
      `INSERT INTO credit_reviews
         (id, airline, confirmation_number, email_id, email_date, subject,
          passenger_id, passenger_name, credited_points, credited_cash_usd,
          status, applied_flight_id, created_at, resolved_at)
       VALUES (:id, :airline, :confirmation_number, :email_id, :email_date, :subject,
          :passenger_id, :passenger_name, :credited_points, :credited_cash_usd,
          :status, :applied_flight_id, :created_at, :resolved_at)`,
      bindParams(item),
    );
  }

  async list(): Promise<CreditReviewItem[]> {
    return queryAll<CreditReviewRow>(
      'SELECT * FROM credit_reviews ORDER BY email_date DESC, id DESC',
    ).map(toDomain);
  }

  async listPending(): Promise<CreditReviewItem[]> {
    return queryAll<CreditReviewRow>(
      "SELECT * FROM credit_reviews WHERE status = 'pending' ORDER BY email_date DESC, id DESC",
    ).map(toDomain);
  }

  async get(id: string): Promise<CreditReviewItem | undefined> {
    const row = queryOne<CreditReviewRow>('SELECT * FROM credit_reviews WHERE id = :id', {
      ':id': id,
    });
    return row ? toDomain(row) : undefined;
  }

  async getByEmailId(emailId: string): Promise<CreditReviewItem | undefined> {
    const row = queryOne<CreditReviewRow>('SELECT * FROM credit_reviews WHERE email_id = :e', {
      ':e': emailId,
    });
    return row ? toDomain(row) : undefined;
  }

  async update(item: CreditReviewItem): Promise<void> {
    execute(
      `UPDATE credit_reviews SET
         airline = :airline, confirmation_number = :confirmation_number,
         email_date = :email_date, subject = :subject,
         passenger_id = :passenger_id, passenger_name = :passenger_name,
         credited_points = :credited_points, credited_cash_usd = :credited_cash_usd,
         status = :status, applied_flight_id = :applied_flight_id, resolved_at = :resolved_at
       WHERE id = :id`,
      bindParams(item),
    );
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM credit_reviews WHERE id = :id', { ':id': id });
  }
}
