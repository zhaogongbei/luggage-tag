import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'fs';
import { join } from 'path';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';
import { startLocalBackend, stopLocalBackend } from './local-backend';

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

let myCapacitorApp: ElectronCapacitorApp | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[char];
  });
}

function canCheckForUpdates(): boolean {
  return !electronIsDev && app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'));
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();
  const capConfig = capacitorFileConfig;
  try {
    const localBackendUrl = await startLocalBackend();
    capConfig.server = { ...(capConfig.server ?? {}), url: `${localBackendUrl}/creator`, cleartext: true };
  } catch (error) {
    console.error('Failed to start local backend:', error);
    capConfig.server = {
      ...(capConfig.server ?? {}),
      url: `data:text/html;charset=utf-8,${encodeURIComponent(
        `<main style="font-family: sans-serif; padding: 32px; line-height: 1.6"><h1>本地打印服务启动失败</h1><p>${escapeHtml(
          String(error?.message ?? error)
        )}</p><p>请确认已安装 Node.js 22.5 或更高版本，并已运行桌面端准备命令。</p></main>`
      )}`,
      cleartext: true,
    };
  }
  // Initialize our app after the local backend URL has been resolved.
  myCapacitorApp = new ElectronCapacitorApp(capConfig, trayMenuTemplate, appMenuBarMenuTemplate);
  if (capConfig.electron?.deepLinkingEnabled) {
    setupElectronDeepLinking(myCapacitorApp, {
      customProtocol: capConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
    });
  }
  if (electronIsDev) {
    setupReloadWatcher(myCapacitorApp);
  }
  // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme(), capConfig.server?.url);
  // Initialize our app, build windows, and load content.
  await myCapacitorApp.init();
  // Directory builds do not include app-update.yml, so skip updater checks unless builder generated config exists.
  if (canCheckForUpdates()) {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.warn('Auto update check skipped:', error?.message ?? error);
    });
  }
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopLocalBackend();
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp?.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
