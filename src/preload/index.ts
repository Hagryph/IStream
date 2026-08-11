import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ClearTrustRequest,
  ConnectivitySnapshot,
  ConnectivitySnapshotListener,
  ConsentDecisionRequest,
  DiscoveredConnectionRequest,
  ManualConnectionRequest
} from '../shared/ConnectivityContracts';
import { IpcChannels } from '../shared/IpcChannels';
import type { IStreamApi, StreamingConfiguration } from '../shared/StreamingConfigurationContracts';

export class PreloadConnectivityBridge {
  public install(): void {
    const api: IStreamApi = {
      getSnapshot: () => ipcRenderer.invoke(IpcChannels.connectivityGetSnapshot) as Promise<ConnectivitySnapshot>,
      refreshDiscovery: () => ipcRenderer.invoke(IpcChannels.connectivityRefreshDiscovery) as Promise<void>,
      clearTrust: (request: ClearTrustRequest) =>
        ipcRenderer.invoke(IpcChannels.connectivityClearTrust, request) as Promise<void>,
      connectDiscovered: (request: DiscoveredConnectionRequest) =>
        ipcRenderer.invoke(IpcChannels.connectivityConnectDiscovered, request) as Promise<void>,
      connectManual: (request: ManualConnectionRequest) =>
        ipcRenderer.invoke(IpcChannels.connectivityConnectManual, request) as Promise<void>,
      respondToPrompt: (request: ConsentDecisionRequest) =>
        ipcRenderer.invoke(IpcChannels.connectivityRespondPrompt, request) as Promise<void>,
      requestReversal: () => ipcRenderer.invoke(IpcChannels.connectivityRequestReversal) as Promise<void>,
      disconnect: () => ipcRenderer.invoke(IpcChannels.connectivityDisconnect) as Promise<void>,
      getStreamConfiguration: () =>
        ipcRenderer.invoke(IpcChannels.configurationGet) as Promise<StreamingConfiguration>,
      updateStreamConfiguration: (configuration: StreamingConfiguration) =>
        ipcRenderer.invoke(IpcChannels.configurationUpdate, configuration) as Promise<StreamingConfiguration>,
      onSnapshot: (listener: ConnectivitySnapshotListener) => {
        const eventListener = (_event: IpcRendererEvent, snapshot: ConnectivitySnapshot): void => listener(snapshot);
        ipcRenderer.on(IpcChannels.connectivitySnapshotChanged, eventListener);
        return (): void => {
          ipcRenderer.removeListener(IpcChannels.connectivitySnapshotChanged, eventListener);
        };
      }
    };
    contextBridge.exposeInMainWorld('istream', api);
  }
}

new PreloadConnectivityBridge().install();
