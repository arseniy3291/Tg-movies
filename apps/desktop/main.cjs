'use strict';
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron');
const path = require('node:path');
let backend;
let mainWindow;
let closing = false;
app.setName('CineGram');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(start).catch(fail);
}

function fail(error) {
  if (!closing) dialog.showErrorBox('CineGram', 'Не удалось запустить приложение.\n' + error.message);
  app.quit();
}

async function start() {
  const url = await new Promise((resolve, reject) => {
    backend = utilityProcess.fork(path.join(__dirname, '../bundle/backend.cjs'), [], {
      env: { ...process.env, CINEGRAM_EMBEDDED: '1' }, stdio: 'pipe', serviceName: 'CineGram Local Backend'
    });
    backend.stdout?.on('data', data => process.stdout.write(data));
    backend.stderr?.on('data', data => process.stderr.write(data));
    const timer = setTimeout(() => reject(new Error('Истекло время запуска локального сервера')), 20000);
    backend.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.url); }
      if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    backend.once('exit', code => { clearTimeout(timer); if (!closing) reject(new Error('Локальный сервер завершился: ' + code)); });
  });
  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1180, height: 820, minWidth: 390, minHeight: 600,
      title: 'CineGram', backgroundColor: '#080808', autoHideMenuBar: true,
      icon: path.join(__dirname, '../bundle/icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== url) { event.preventDefault(); if (/^https?:\/\//i.test(target)) shell.openExternal(target); }
    });
    const session = mainWindow.webContents.session;
    session.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'fullscreen'));
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadURL(url);
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'CineGram', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Вид', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  backend.on('exit', () => { if (!closing) fail(new Error('Локальный сервер остановился. Перезапустите приложение.')); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { closing = true; backend?.kill(); });
