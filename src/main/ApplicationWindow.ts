import {
  BrowserWindow,
  desktopCapturer,
  screen,
  session,
  type DesktopCapturerSource,
  type RenderProcessGoneDetails
} from 'electron';
import { join } from 'node:path';

export class ApplicationWindow {
  #window: BrowserWindow | null = null;
  #primaryScreenSourcePromise: Promise<DesktopCapturerSource | null> | null = null;
  #rendererRecoveryAttempts: number = 0;

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
    this.#window.webContents.on('render-process-gone', (_event, details) => this.recoverRenderer(details));
    this.#window.webContents.once('did-finish-load', () => this.prewarmPrimaryScreenSource());
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
      const sourcePromise = this.#primaryScreenSourcePromise ?? this.loadPrimaryScreenSource();
      void sourcePromise
        .then((primaryScreen) => {
          if (primaryScreen === null || !request.videoRequested) {
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

  private async loadPrimaryScreenSource(): Promise<DesktopCapturerSource | null> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    });
    const primaryDisplayId = String(screen.getPrimaryDisplay().id);
    return sources.find((source) => source.display_id === primaryDisplayId) ?? sources[0] ?? null;
  }

  private prewarmPrimaryScreenSource(): void {
    if (this.#primaryScreenSourcePromise === null) {
      this.#primaryScreenSourcePromise = this.loadPrimaryScreenSource().catch(() => null);
    }
  }

  private recoverRenderer(details: RenderProcessGoneDetails): void {
    if (details.reason === 'clean-exit' || this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    this.#rendererRecoveryAttempts += 1;
    if (this.#rendererRecoveryAttempts > 3) {
      return;
    }
    setTimeout(() => {
      if (this.#window !== null && !this.#window.isDestroyed()) {
        this.#window.webContents.reload();
      }
    }, 1000);
  }
}
