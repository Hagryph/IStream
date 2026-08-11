import type { IStreamApi } from '../shared/StreamingConfigurationContracts';

declare global {
  interface Window {
    readonly istream: IStreamApi;
  }
}

export {};
