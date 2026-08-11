import type { ConnectivityApi } from './ConnectivityContracts';
import type { MediaApi } from './MediaContracts';

export enum StreamingPreset {
  Gaming = 'gaming',
  Desktop = 'desktop'
}

export enum VideoCodec {
  H264 = 'h264',
  Hevc = 'hevc'
}

export enum HdrMode {
  Off = 'off',
  Automatic = 'automatic'
}

export enum CapacityFloorMode {
  FreezeAndReconnectAtHd = 'freeze-and-reconnect-at-hd',
  AllowBelowHd = 'allow-below-hd'
}

export interface StreamingConfiguration {
  readonly preset: StreamingPreset;
  readonly codec: VideoCodec;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly targetFramesPerSecond: number;
  readonly minimumFramesPerSecond: number;
  readonly maximumBitrateMbps: number;
  readonly hdrMode: HdrMode;
  readonly capacityFloorMode: CapacityFloorMode;
  readonly inputEnabled: boolean;
  readonly applicationSafetyLockEnabled: boolean;
  readonly protectedApplications: readonly string[];
}

export interface StreamConfigurationApi {
  getStreamConfiguration(): Promise<StreamingConfiguration>;
  updateStreamConfiguration(configuration: StreamingConfiguration): Promise<StreamingConfiguration>;
}

export interface IStreamApi extends ConnectivityApi, StreamConfigurationApi, MediaApi {}

export class StreamingConfigurationDefaults {
  public static stableGaming(): StreamingConfiguration {
    return {
      preset: StreamingPreset.Gaming,
      codec: VideoCodec.H264,
      targetWidth: 1920,
      targetHeight: 1080,
      targetFramesPerSecond: 60,
      minimumFramesPerSecond: 30,
      maximumBitrateMbps: 35,
      hdrMode: HdrMode.Off,
      capacityFloorMode: CapacityFloorMode.FreezeAndReconnectAtHd,
      inputEnabled: false,
      applicationSafetyLockEnabled: true,
      protectedApplications: ['League of Legends.exe', 'LeagueClientUx.exe']
    };
  }
}
