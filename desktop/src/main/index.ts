import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { logger } from '@swr/core';
import appIcon from '../../resources/icon.png?asset';
import { loadAppConfig } from './config.js';
import { closeDatabase, initDatabase } from './database/db.js';
import { buildContainer, type AppContainer } from './container.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { IPC } from '../shared/ipc.js';

const log = logger.child('main');

let mainWindow: BrowserWindow | null = null;
let container: AppContainer | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Rebook Radar',
    icon: appIcon,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Safely push an event to the renderer. */
function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.rebookradar.app');

  const config = loadAppConfig();
  await initDatabase();

  container = buildContainer(config, {
    status: (s) => send(IPC.evtMonitorStatus, s),
    priceUpdate: (e) => send(IPC.evtPriceUpdate, e),
    alert: (e) => send(IPC.evtAlert, e),
    emailProgress: (e) => send(IPC.evtEmailImportProgress, e),
  });

  registerIpcHandlers(container, () => mainWindow);

  // Start background monitoring if the user enabled it previously.
  if (container.settings.get().monitoringEnabled) {
    container.monitor.start();
  }

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  log.info('Application ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    container?.monitor.stop();
    closeDatabase();
    app.quit();
  }
});

app.on('before-quit', () => {
  container?.monitor.stop();
  closeDatabase();
});
