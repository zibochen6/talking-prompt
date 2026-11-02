import { app, BrowserWindow, dialog, Menu, Notification, shell } from 'electron';
import { resolve } from 'node:path';
import { createPromptServer } from '../server/app.ts';
import { defaultDataDir, legacyDataDirs, prepareDataDir, withReservedPort } from '../server/storage.ts';
import { checkLatestRelease, type UpdateResult } from './updates.ts';

const PORT = 3210;
let window: BrowserWindow | undefined;
let server: ReturnType<typeof createPromptServer> | undefined;
let shuttingDown = false;
let updateTimer: NodeJS.Timeout | undefined;
let checking = false;
let available: Extract<UpdateResult, { kind: 'available' }> | undefined;

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '同频', submenu: [
      { label: `关于同频 ${app.getVersion()}`, role: 'about' },
      { label: available ? `发现新版本 ${available.version}，前往下载` : '检查更新…', click: () => { if (available) void shell.openExternal(available.url); else void checkUpdates(true); } },
      { type: 'separator' }, { role: 'quit', label: '退出同频' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] },
  ]));
}
async function checkUpdates(manual: boolean) {
  if (checking) return;
  checking = true;
  try {
    const result = await checkLatestRelease(app.getVersion());
    if (result.kind === 'available') {
      const isNew = available?.version !== result.version;
      available = result; menu();
      if (manual) {
        const choice = await dialog.showMessageBox({ type: 'info', title: '发现新版本', message: `同频 ${result.version} 已发布`, detail: '打开下载页面后，下载适合你的 Mac 的安装包并手动安装。当前提词不会被中断。', buttons: ['打开下载页面', '稍后'], defaultId: 0, cancelId: 1 });
        if (choice.response === 0) await shell.openExternal(result.url);
      } else if (isNew && Notification.isSupported()) {
        const notification = new Notification({ title: '同频有新版本', body: `版本 ${result.version} 已发布。点击打开下载页面。` });
        notification.on('click', () => { void shell.openExternal(result.url); }); notification.show();
      }
    } else if (manual) {
      await dialog.showMessageBox({ type: result.kind === 'error' ? 'warning' : 'info', title: '检查更新', message: result.kind === 'error' ? '暂时无法检查更新' : '当前已是最新版本', detail: result.kind === 'error' ? '请检查网络连接后重试；本地提词仍可正常使用。' : `当前版本：${app.getVersion()}`, buttons: ['好'] });
    }
  } finally { checking = false; }
}
function createWindow() {
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 700, minHeight: 500, title: '同频 · 局域网提词器', backgroundColor: '#000000', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`http://localhost:${PORT}/`)) event.preventDefault(); });
  void window.loadURL(`http://localhost:${PORT}/`);
  window.on('closed', () => { window = undefined; });
}
const hasLock = app.requestSingleInstanceLock();
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (server) createWindow(); });
  app.whenReady().then(async () => {
    try {
      const dataDir = process.env.PROMPT_DATA_DIR ?? defaultDataDir();
      const projectRoot = app.isPackaged ? undefined : app.getAppPath();
      await withReservedPort(PORT, () => prepareDataDir(dataDir, process.env.PROMPT_DATA_DIR ? [] : legacyDataDirs(projectRoot)));
      server = createPromptServer({ dataDir, distDir: resolve(app.getAppPath(), 'dist') });
      await new Promise<void>((resolveListen, reject) => { server!.server.once('error', reject); server!.server.listen(PORT, '0.0.0.0', () => resolveListen()); });
      menu(); createWindow();
      if (app.isPackaged && !process.env.PROMPT_DISABLE_UPDATE_CHECK) {
        void checkUpdates(false);
        updateTimer = setInterval(() => { void checkUpdates(false); }, 24 * 60 * 60 * 1000);
      }
    } catch (error) {
      const message = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用。请先关闭正在运行的提词器，然后重新打开同频。` : `无法启动同频：${error instanceof Error ? error.message : error}`;
      await dialog.showMessageBox({ type: 'error', title: '启动失败', message, buttons: ['好'] });
      // The server has not started listening, so don't attempt to close it.
      server = undefined; app.quit();
    }
  });
  app.on('activate', () => { if (!window && server) createWindow(); });
  app.on('window-all-closed', () => { /* The Mac menu bar keeps the LAN service running until Quit. */ });
  app.on('before-quit', event => {
    if (shuttingDown || !server) return;
    event.preventDefault(); shuttingDown = true;
    if (updateTimer) clearInterval(updateTimer);
    void server.close().finally(() => { server = undefined; app.exit(0); });
  });
}
