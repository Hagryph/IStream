import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export class ApplicationWindow {
  #window: BrowserWindow | null = null;

  public create(): BrowserWindow {
    const smokeTest = process.argv.includes('--istream-smoke-test');
    this.#window = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 880,
      minHeight: 620,
      backgroundColor: '#070c14',
      show: false,
      title: 'IStream',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.#window.removeMenu();
    this.#window.once('ready-to-show', () => {
      if (!smokeTest) {
        this.#window?.show();
      }
    });
    const developmentUrl = process.env.ELECTRON_RENDERER_URL;
    if (developmentUrl !== undefined) {
      void this.#window.loadURL(developmentUrl);
    } else {
      void this.#window.loadFile(join(__dirname, '../renderer/index.html'));
    }
    return this.#window;
  }
}
