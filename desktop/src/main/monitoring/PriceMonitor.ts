import { Recommendation, logger } from '@swr/core';
import type { AlertEvent, FlightWithComparison, MonitorStatus, PriceUpdateEvent } from '../../shared/dto.js';
import type { Notifier } from '../notifications/Notifier.js';

const log = logger.child('monitor');

export interface PriceMonitorDeps {
  /** Runs a price check for every monitored flight. */
  checkAll: () => Promise<FlightWithComparison[]>;
  /** Current poll interval in minutes. */
  getIntervalMinutes: () => number;
  notifier: Notifier;
  onStatus: (status: MonitorStatus) => void;
  onPriceUpdate: (event: PriceUpdateEvent) => void;
  onAlert: (event: AlertEvent) => void;
}

/**
 * Background price poller. Runs `checkAll` on a configurable interval and emits
 * toast notifications + renderer events when a flight is recommended for
 * rebooking (i.e. savings cleared the user's threshold).
 */
export class PriceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt?: string;
  private nextRunAt?: string;
  private lastError?: string;
  private inFlight = false;

  constructor(private readonly deps: PriceMonitorDeps) {}

  start(): MonitorStatus {
    if (this.running) return this.status();
    this.running = true;
    const intervalMs = Math.max(1, this.deps.getIntervalMinutes()) * 60_000;
    log.info('Starting price monitor', { intervalMinutes: this.deps.getIntervalMinutes() });

    // Run once immediately, then on the interval.
    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
    this.scheduleNext(intervalMs);
    this.emitStatus();
    return this.status();
  }

  stop(): MonitorStatus {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.nextRunAt = undefined;
    log.info('Stopped price monitor');
    this.emitStatus();
    return this.status();
  }

  /** Restart with the latest interval (call after settings change). */
  restart(): MonitorStatus {
    this.stop();
    return this.start();
  }

  status(): MonitorStatus {
    return {
      running: this.running,
      intervalMinutes: this.deps.getIntervalMinutes(),
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
    };
  }

  private scheduleNext(intervalMs: number): void {
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  }

  private emitStatus(): void {
    this.deps.onStatus(this.status());
  }

  private async runCycle(): Promise<void> {
    if (this.inFlight) {
      log.debug('Skipping cycle; previous run still in progress.');
      return;
    }
    this.inFlight = true;
    this.lastError = undefined;
    try {
      const results = await this.deps.checkAll();
      this.lastRunAt = new Date().toISOString();

      for (const result of results) {
        if (!result.comparison) continue;
        this.deps.onPriceUpdate({ flightId: result.flight.id, comparison: result.comparison });

        if (result.comparison.recommendation === Recommendation.Rebook) {
          const route = `${result.flight.route.origin.code}→${result.flight.route.destination.code}`;
          const alert: AlertEvent = {
            flightId: result.flight.id,
            passengerName: result.passengerName,
            route,
            message: `${result.passengerName}: ${result.comparison.rationale}`,
          };
          this.deps.notifier.notifyAlert(alert);
          this.deps.onAlert(alert);
        }
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.error('Price monitor cycle failed', { error: this.lastError });
    } finally {
      this.inFlight = false;
      this.scheduleNext(Math.max(1, this.deps.getIntervalMinutes()) * 60_000);
      this.emitStatus();
    }
  }
}
