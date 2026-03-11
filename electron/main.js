const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  session,
  systemPreferences,
} = require('electron');
const path = require('path');

async function getActiveWindowSource() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    const mySourceId = mainWindow?.getMediaSourceId();
    const match = sources.find((s) => s.id !== mySourceId);
    return match ? { id: match.id, name: match.name } : null;
  } catch {
    return null;
  }
}

const isDev = !app.isPackaged;
let mainWindow = null;

function createWindow() {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'favicon.ico')
    : path.join(__dirname, '..', 'build', 'favicon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1e1f22',
    show: false,
  });

  mainWindow.setMenuBarVisibility(false);

  const url = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '..', 'build', 'index.html')}`;
  mainWindow.loadURL(url).catch();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture', 'audioCapture', 'videoCapture', 'fullscreen'];

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.includes(permission);
  });
}

// --- IPC: desktopCapturer ---
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('get-active-window-source', () => getActiveWindowSource());

// --- IPC: globalShortcut ---
let registeredShortcuts = new Map();

ipcMain.handle('register-global-shortcuts', (_event, mapping) => {
  // mapping = { muteMic: 'num4', mutePeers: 'num5', switchScreen: 'num9' }
  for (const accel of registeredShortcuts.values()) {
    globalShortcut.unregister(accel);
  }
  registeredShortcuts.clear();

  for (const [action, accelerator] of Object.entries(mapping)) {
    if (!accelerator) continue;
    try {
      globalShortcut.register(accelerator, async () => {
        if (action === 'switchScreen') {
          const source = await getActiveWindowSource();
          mainWindow?.webContents.send('hotkey-pressed', action, source);
        } else {
          mainWindow?.webContents.send('hotkey-pressed', action);
        }
      });
      registeredShortcuts.set(action, accelerator);
    } catch (e) {
      console.warn(`Failed to register shortcut "${accelerator}" for "${action}":`, e.message);
    }
  }
});

// Запрещаем приложению регулировать громкость микрофона, чтобы в других приложениях "не крутил"
app.commandLine.appendSwitch('--disable-features', 'WebRtcAllowInputVolumeAdjustment');

// --- macOS: запрос системных разрешений на микрофон и камеру ---
async function requestMediaAccess() {
  if (process.platform !== 'darwin') return;
  await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  await systemPreferences.askForMediaAccess('camera').catch(() => {});
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  await requestMediaAccess();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
