import { app } from 'electron';

export function applyAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
      path: process.execPath,
      args: app.isPackaged ? ['--background'] : [app.getAppPath(), '--background']
    });
  } catch (_error) {
    // The app remains usable if Windows refuses the per-user startup entry.
  }
}
