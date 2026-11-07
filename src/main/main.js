import { app, BrowserWindow, clipboard, Menu, nativeImage, Notification, shell, Tray, ipcMain } from 'electron';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalendarService } from './services/calendar-service.js';
import { LocalFeedServer } from './services/local-feed-server.js';
import { PersistentStore } from './services/persistent-store.js';
import { applyAutoLaunch } from './services/startup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const feedUrl = 'http://127.0.0.1:48537/calendar.ics';
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  let mainWindow;
  let tray;
  let syncTimer;
  const store = new PersistentStore();
  const calendarService = new CalendarService(store);
  const feedServer = new LocalFeedServer(() => calendarService.getCalendarItems());

  app.on('second-instance', () => {
    showWindow();
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 880,
      minHeight: 600,
      show: false,
      backgroundColor: '#f5f7fb',
      autoHideMenuBar: true,
      title: 'Calendario Unificato',
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.loadFile(path.join(here, '..', 'renderer', 'index.html'));
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
    mainWindow.webContents.on('did-finish-load', () => publishState());
  }

  function showWindow() {
    if (!mainWindow) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function getUiSnapshot() {
    return {
      ...calendarService.getSnapshot(),
      feed: feedServer.getStatus()
    };
  }

  function publishState() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
    mainWindow.webContents.send('state:changed', getUiSnapshot());
  }

  function createTrayIcon() {
    const width = 32;
    const height = 32;
    const pixels = Buffer.alloc(width * height * 4, 0);
    const setPixel = (x, y, color) => {
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    };
    const navy = [32, 71, 133, 255];
    const white = [255, 255, 255, 255];
    const ink = [54, 79, 117, 255];
    for (let y = 4; y < 29; y += 1) {
      for (let x = 4; x < 28; x += 1) {
        setPixel(x, y, y < 11 ? navy : white);
      }
    }
    for (let x = 9; x <= 10; x += 1) {
      for (let y = 2; y <= 8; y += 1) setPixel(x, y, navy);
    }
    for (let x = 21; x <= 22; x += 1) {
      for (let y = 2; y <= 8; y += 1) setPixel(x, y, navy);
    }
    for (const [x, y] of [[9, 15], [16, 15], [23, 15], [9, 22], [16, 22], [23, 22]]) {
      for (let dx = 0; dx < 3; dx += 1) {
        for (let dy = 0; dy < 3; dy += 1) setPixel(x + dx, y + dy, ink);
      }
    }

    const rows = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (1 + width * 4);
      rows[rowStart] = 0;
      pixels.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }
    const crc32 = (buffer) => {
      let crc = 0xffffffff;
      for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const typeBytes = Buffer.from(type);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
      return Buffer.concat([length, typeBytes, data, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0))
    ]);
    return nativeImage.createFromBuffer(png);
  }

  function createTray() {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Calendario Unificato · feed Lumabar attivo');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Apri calendario', click: showWindow },
      {
        label: 'Sincronizza adesso',
        click: async () => {
          await calendarService.syncAll();
          publishState();
        }
      },
      { type: 'separator' },
      {
        label: 'Stato del feed Lumabar',
        click: () => {
          new Notification({
            title: 'Feed locale attivo',
            body: feedUrl
          }).show();
        }
      },
      { type: 'separator' },
      {
        label: 'Esci',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  }

  ipcMain.handle('state:get', () => getUiSnapshot());
  ipcMain.handle('sync:start', async () => {
    const result = await calendarService.syncAll();
    publishState();
    return result;
  });
  ipcMain.handle('account:add', async (_event, provider) => {
    const account = await calendarService.addAccount(provider, shell);
    publishState();
    return account;
  });
  ipcMain.handle('account:remove', async (_event, accountId) => {
    await calendarService.removeAccount(accountId);
    publishState();
    return true;
  });
  ipcMain.handle('calendar:toggle', async (_event, calendarKey, enabled) => {
    await calendarService.setCalendarEnabled(calendarKey, enabled);
    await calendarService.syncAll({ silent: true });
    publishState();
    return true;
  });
  ipcMain.handle('settings:save', async (_event, settings) => {
    await calendarService.saveSettings(settings);
    applyAutoLaunch(Boolean(settings.autoStart));
    publishState();
    return true;
  });
  ipcMain.handle('feed:copy-url', () => {
    clipboard.writeText(feedUrl);
    return feedUrl;
  });

  app.whenReady().then(async () => {
    await store.load();
    await feedServer.start();
    createWindow();
    createTray();
    applyAutoLaunch(calendarService.getSnapshot().settings.autoStart);

    if (process.argv.includes('--background')) {
      mainWindow.hide();
    } else {
      showWindow();
    }

    await calendarService.syncAll({ silent: true });
    publishState();
    syncTimer = setInterval(async () => {
      await calendarService.syncAll({ silent: true });
      publishState();
    }, 15 * 60 * 1000);
  });

  app.on('activate', showWindow);
  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });
  app.on('before-quit', () => {
    app.isQuitting = true;
    if (syncTimer) clearInterval(syncTimer);
    feedServer.stop();
    if (tray) tray.destroy();
  });
}
