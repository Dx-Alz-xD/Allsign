import { app, BrowserWindow, net, protocol, shell, type WebFrameMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAccountIpc } from './account';
import { registerDirectPasteIpc } from './directPaste';
import {
  GlobalHotkeyManager,
  HOTKEY_ACTIONS,
  HOTKEY_ARG_PREFIX,
  bindingsWithOverrides,
  hotkeyActionFromArgv,
} from './GlobalHotkeyManager';
import { registerHotkeyIpc } from './hotkeyIpc';
import { loadHotkeyOverrides } from './hotkeyStore';
import type { HotkeyAction, IpcEventChannel } from './ipc';

const isDev = process.argv.includes('--dev');
const DEV_SERVER_URL = 'http://localhost:3000';
const APP_SCHEME = 'app';
const APP_URL = `${APP_SCHEME}://omnivoice/`;
const STATIC_EXPORT_DIR = path.join(__dirname, '..', 'out');

// Wayland compositors only deliver global shortcuts through the XDG GlobalShortcuts portal, which
// Chromium keeps behind a feature flag. Must be set before app ready.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
}

// Must run before app ready so app:// behaves like a secure, standard origin.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveStaticExport(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const target = path.resolve(STATIC_EXPORT_DIR, `.${decodeURIComponent(pathname)}`);
    const relative = path.relative(STATIC_EXPORT_DIR, target);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Not found', { status: 404 });
    }

    const filePath = path.extname(target) ? target : path.join(target, 'index.html');
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function loadDevServer(win: BrowserWindow): Promise<void> {
  let warned = false;
  while (!win.isDestroyed()) {
    try {
      await win.loadURL(DEV_SERVER_URL);
      return;
    } catch {
      if (!warned) {
        console.log(`Waiting for Next.js dev server at ${DEV_SERVER_URL} (run "npm run dev")`);
        warned = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

let mainWindow: BrowserWindow | null = null;
let hotkeys: GlobalHotkeyManager | null = null;

/** Only Voicematics' own pages may call privileged IPC (keyboard automation, hotkey state, the account). */
function isTrustedSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    const url = new URL(frame.url);
    return isDev
      ? url.protocol === 'http:' && url.host === new URL(DEV_SERVER_URL).host
      : url.protocol === `${APP_SCHEME}:` && url.host === new URL(APP_URL).host;
  } catch {
    return false;
  }
}

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function handleHotkey(action: HotkeyAction): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  // An emergency alert must be seen, and Studio is a presentation view; muting stays in the background.
  if (action === 'emergency-alert' || action === 'toggle-pitch-mode') bringToFront(win);
  if (action === 'emergency-alert') {
    win.flashFrame(true);
    win.once('focus', () => win.flashFrame(false));
  }

  const channel: IpcEventChannel = 'hotkeys:action';
  win.webContents.send(channel, action);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    title: 'Voicematics',
    backgroundColor: '#0B0F17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Direct paste listens while the window is minimised or behind another app: keep timers, workers
      // and the audio pipeline at full speed in the background.
      backgroundThrottling: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void loadDevServer(win);
  } else {
    void win.loadURL(APP_URL);
  }
}

/**
 * Command that forwards a hotkey action to the running instance, for desktops where the app cannot
 * register global shortcuts itself (e.g. binding keys in a Wayland compositor's config).
 */
function hotkeyTriggerCommand(action: HotkeyAction): string {
  const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
  const parts = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  return [...parts.map(quote), `${HOTKEY_ARG_PREFIX}${action}`].join(' ');
}

// A second launch forwards its --hotkey action (or just focuses the window) and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const action = hotkeyActionFromArgv(argv);
    if (action) hotkeys?.trigger(action);
    else if (mainWindow) bringToFront(mainWindow);
  });

  app.whenReady().then(() => {
    if (!isDev) serveStaticExport();

    registerDirectPasteIpc({ getWindow: () => mainWindow, isTrustedSender });
    registerAccountIpc({ isTrustedSender });

    hotkeys = new GlobalHotkeyManager(handleHotkey, {
      bindings: bindingsWithOverrides(loadHotkeyOverrides(HOTKEY_ACTIONS)),
      triggerCommand: hotkeyTriggerCommand,
    });
    for (const registration of hotkeys.registerAll()) {
      if (!registration.registered) {
        console.warn(`Global shortcut ${registration.accelerator} (${registration.label}) is taken by another app.`);
      }
    }
    registerHotkeyIpc({ manager: hotkeys, isTrustedSender });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    hotkeys?.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
