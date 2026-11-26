const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const { mkdirSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const name = 'Исследование операций';
const index = path.join(__dirname, 'ui', 'index.html');
const mainPage = pathToFileURL(index).href;
const profile = path.join(process.resourcesPath, 'operations-profile');

app.setName(name);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);

let window;

function register(channel, callback) {
  ipcMain.handle(channel, (event, text) => {
    const fromMainPage = event.sender === window?.webContents && event.senderFrame?.url === mainPage;
    if (!fromMainPage) throw new Error('Недоступное действие.');
    if (typeof text !== 'string') return false;
    return callback(text);
  });
}

register('lab:copy', text => {
  clipboard.writeText(text);
  return true;
});

register('lab:save', async text => {
  const target = await dialog.showSaveDialog(window, {
    title: 'Сохранить отчёт',
    defaultPath: 'решение.txt',
    filters: [{ name: 'Текстовый файл', extensions: ['txt'] }],
  });
  if (target.canceled || !target.filePath) return false;

  await writeFile(target.filePath, text, 'utf8');
  return true;
});

app.whenReady().then(() => {
  window = new BrowserWindow({
    title: name,
    width: 1370,
    height: 850,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.removeMenu();
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());
  return window.loadFile(index);
}).catch(() => {
  dialog.showErrorBox(name, 'Не удалось открыть окно лабораторной.');
  app.quit();
});

app.on('window-all-closed', () => app.quit());
