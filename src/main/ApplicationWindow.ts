import { BrowserWindow, desktopCapturer, screen, session } from 'electron';
import { join } from 'node:path';

export class ApplicationWindow {
  #window: BrowserWindow | null = null;

  public create(): BrowserWindow {
    this.installDisplayCaptureHandler();
    const smokeTest = process.argv.includes('--istream-smoke-test');
    this.#window = new BrowserWindow({
      width: 1500,
      height: 980,
      minWidth: 1000,
      minHeight: 700,
      backgroundColor: '#070c14',
      show: false,
      title: 'IStream',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required'
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

  private installDisplayCaptureHandler(): void {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const primaryDisplayId = String(screen.getPrimaryDisplay().id);
          const primaryScreen = sources.find((source) => source.display_id === primaryDisplayId) ?? sources[0];
          if (primaryScreen === undefined || !request.videoRequested) {
            callback({});
            return;
          }
          callback({
            video: primaryScreen,
            audio: request.audioRequested ? 'loopback' : undefined,
            enableLocalEcho: false
          });
        })
        .catch(() => callback({}));
    });
  }
}
