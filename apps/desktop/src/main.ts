// Desktop main process (Electron)

import { app, BrowserWindow, ipcMain } from 'electron';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // 为了简化 IPC 通信，暂时关闭隔离（生产环境建议开启）
    },
  });

  mainWindow.loadFile('public/index.html');

  // 默认忽略鼠标事件（穿透），但在有内容的区域（通过前端发送 set-ignore-mouse-events）时捕获
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // 监听前端发送的鼠标穿透控制事件
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setIgnoreMouseEvents(ignore, options);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});