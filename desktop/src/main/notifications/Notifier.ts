import { Notification } from 'electron';
import { logger } from '@swr/core';
import type { AlertEvent } from '../../shared/dto.js';

const log = logger.child('notifier');

/** Thin wrapper around Electron's native Notification (Windows toast). */
export class Notifier {
  notifyAlert(alert: AlertEvent): void {
    if (!Notification.isSupported()) {
      log.warn('Native notifications are not supported on this platform.');
      return;
    }
    const notification = new Notification({
      title: `Price drop: ${alert.route}`,
      body: alert.message,
      silent: false,
    });
    notification.show();
  }

  notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  }
}
