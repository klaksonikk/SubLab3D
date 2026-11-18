const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const isDevMode = process.argv.includes('--dev');

function createMainWindow() {
  const iconPath = path.join(
    __dirname,
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0A0B0E',
    title: 'SubLab 3D — Projektant Obudów & WSD',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDevMode) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const distHtml = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(distHtml);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

ipcMain.handle('save-json-file', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const defaultName =
    payload && typeof payload.defaultName === 'string' && payload.defaultName.trim()
      ? payload.defaultName.trim()
      : 'sublab-wsd-export.json';
  const content =
    payload && typeof payload.content === 'string' ? payload.content : '{}';

  const result = await dialog.showSaveDialog(win || undefined, {
    title: 'Zapisz dane akustyczne (JSON)',
    defaultPath: defaultName,
    filters: [{ name: 'Plik JSON', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) {
    return { saved: false };
  }

  fs.writeFileSync(result.filePath, content, 'utf8');
  return { saved: true, filePath: result.filePath };
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
