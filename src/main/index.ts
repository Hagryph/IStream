import { app, BrowserWindow } from 'electron';
import { ConnectivityDefaults } from '../shared/ConnectivityContracts';
import { ApplicationWindow } from './ApplicationWindow';
import { ConnectivityIpcController } from './ConnectivityIpcController';
import { ConnectivityFacade } from './connectivity/ConnectivityFacade';
import { StreamConfigurationService } from './configuration/StreamConfigurationService';
import { DiagnosticDefaults } from '../shared/DiagnosticContracts';

export class IStreamApplication {
  #facade: ConnectivityFacade | null = null;
  #ipcController: ConnectivityIpcController | null = null;

  public run(): void {
    void app.whenReady().then(() => this.start());
    app.on('window-all-closed', () => {
      app.quit();
    });
    app.on('before-quit', () => {
      this.#ipcController?.uninstall();
      void this.#facade?.stop();
    });
  }

  private async start(): Promise<void> {
    this.#facade = new ConnectivityFacade({
      userDataPath: app.getPath('userData'),
      enableDiscovery: true,
      preferredControlPort: ConnectivityDefaults.preferredControlPort,
      enableLocalDiagnosticsServer: true,
      preferredDiagnosticsPort: DiagnosticDefaults.preferredLoopbackPort
    });
    const configurationService = new StreamConfigurationService(app.getPath('userData'));
    await configurationService.load();
    this.#ipcController = new ConnectivityIpcController(this.#facade, configurationService);
    this.#ipcController.install();
    new ApplicationWindow().create();
    try {
      await this.#facade.start();
    } catch {
      return;
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        new ApplicationWindow().create();
      }
    });
  }
}

new IStreamApplication().run();
