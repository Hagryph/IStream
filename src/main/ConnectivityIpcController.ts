import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type {
  ConsentDecisionRequest,
  DiscoveredConnectionRequest,
  ManualConnectionRequest
} from '../shared/ConnectivityContracts';
import { IpcChannels } from '../shared/IpcChannels';
import type { StreamingConfiguration } from '../shared/StreamingConfigurationContracts';
import { StreamConfigurationService } from './configuration/StreamConfigurationService';
import { ConnectivityFacade } from './connectivity/ConnectivityFacade';

export class ConnectivityIpcController {
  readonly #facade: ConnectivityFacade;
  readonly #configurationService: StreamConfigurationService;

  public constructor(facade: ConnectivityFacade, configurationService: StreamConfigurationService) {
    this.#facade = facade;
    this.#configurationService = configurationService;
  }

  public install(): void {
    ipcMain.handle(IpcChannels.connectivityGetSnapshot, () => this.#facade.snapshot());
    ipcMain.handle(
      IpcChannels.connectivityConnectDiscovered,
      (_event: IpcMainInvokeEvent, request: DiscoveredConnectionRequest) => this.#facade.connectDiscovered(request)
    );
    ipcMain.handle(
      IpcChannels.connectivityConnectManual,
      (_event: IpcMainInvokeEvent, request: ManualConnectionRequest) => this.#facade.connectManual(request)
    );
    ipcMain.handle(
      IpcChannels.connectivityRespondPrompt,
      (_event: IpcMainInvokeEvent, request: ConsentDecisionRequest) => this.#facade.respondToPrompt(request)
    );
    ipcMain.handle(IpcChannels.connectivityRequestReversal, () => this.#facade.requestReversal());
    ipcMain.handle(IpcChannels.connectivityDisconnect, () => this.#facade.disconnect());
    ipcMain.handle(IpcChannels.configurationGet, () => this.#configurationService.get());
    ipcMain.handle(
      IpcChannels.configurationUpdate,
      (_event: IpcMainInvokeEvent, configuration: StreamingConfiguration) => this.#configurationService.update(configuration)
    );
    this.#facade.subscribe((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IpcChannels.connectivitySnapshotChanged, snapshot);
        }
      }
    });
  }

  public uninstall(): void {
    ipcMain.removeHandler(IpcChannels.connectivityGetSnapshot);
    ipcMain.removeHandler(IpcChannels.connectivityConnectDiscovered);
    ipcMain.removeHandler(IpcChannels.connectivityConnectManual);
    ipcMain.removeHandler(IpcChannels.connectivityRespondPrompt);
    ipcMain.removeHandler(IpcChannels.connectivityRequestReversal);
    ipcMain.removeHandler(IpcChannels.connectivityDisconnect);
    ipcMain.removeHandler(IpcChannels.configurationGet);
    ipcMain.removeHandler(IpcChannels.configurationUpdate);
  }
}
