import { join } from 'node:path';
import {
  CapacityFloorMode,
  HdrMode,
  StreamingConfigurationDefaults,
  StreamingPreset,
  VideoCodec,
  type StreamingConfiguration
} from '../../shared/StreamingConfigurationContracts';
import { AtomicJsonStore } from '../storage/AtomicJsonStore';

export class StreamConfigurationValidator {
  public validate(configuration: StreamingConfiguration): StreamingConfiguration {
    if (!Object.values(StreamingPreset).includes(configuration.preset)) {
      throw new Error('Unknown streaming preset.');
    }
    if (!Object.values(VideoCodec).includes(configuration.codec)) {
      throw new Error('Unknown video codec.');
    }
    if (!Object.values(HdrMode).includes(configuration.hdrMode)) {
      throw new Error('Unknown HDR mode.');
    }
    if (!Object.values(CapacityFloorMode).includes(configuration.capacityFloorMode)) {
      throw new Error('Unknown capacity floor behavior.');
    }
    if (!['1280x720', '1920x1080', '2560x1440', '3840x2160'].includes(`${configuration.targetWidth}x${configuration.targetHeight}`)) {
      throw new Error('Unsupported target resolution.');
    }
    if (![30, 60, 90, 120].includes(configuration.targetFramesPerSecond)) {
      throw new Error('Target frame rate must use a supported step.');
    }
    if (![15, 20, 30, 45, 60].includes(configuration.minimumFramesPerSecond)) {
      throw new Error('Minimum frame rate must use a supported step.');
    }
    if (configuration.minimumFramesPerSecond > configuration.targetFramesPerSecond) {
      throw new Error('Minimum frame rate cannot exceed the target.');
    }
    if (!Number.isFinite(configuration.maximumBitrateMbps) || configuration.maximumBitrateMbps < 5 || configuration.maximumBitrateMbps > 200) {
      throw new Error('Maximum bitrate must be between 5 and 200 Mbps.');
    }
    if (typeof configuration.inputEnabled !== 'boolean' || typeof configuration.applicationSafetyLockEnabled !== 'boolean') {
      throw new Error('Input settings are invalid.');
    }
    if (!Array.isArray(configuration.protectedApplications) || configuration.protectedApplications.length > 50) {
      throw new Error('Protected application list is invalid.');
    }
    const protectedApplications = configuration.protectedApplications
      .map((application) => application.trim())
      .filter((application) => application.length > 0);
    if (protectedApplications.some((application) => application.length > 260)) {
      throw new Error('Protected application list is invalid.');
    }
    return {
      ...configuration,
      maximumBitrateMbps: Math.round(configuration.maximumBitrateMbps),
      protectedApplications: [...new Set(protectedApplications)]
    };
  }
}

export class StreamConfigurationService {
  readonly #store: AtomicJsonStore<StreamingConfiguration>;
  readonly #validator: StreamConfigurationValidator;
  #configuration: StreamingConfiguration = StreamingConfigurationDefaults.stableGaming();

  public constructor(userDataPath: string, validator: StreamConfigurationValidator = new StreamConfigurationValidator()) {
    this.#store = new AtomicJsonStore<StreamingConfiguration>(join(userDataPath, 'stream-configuration.json'));
    this.#validator = validator;
  }

  public async load(): Promise<void> {
    const stored = await this.#store.read();
    if (stored !== null) {
      try {
        this.#configuration = this.#validator.validate(stored);
      } catch {
        this.#configuration = StreamingConfigurationDefaults.stableGaming();
      }
    }
  }

  public get(): StreamingConfiguration {
    return { ...this.#configuration, protectedApplications: [...this.#configuration.protectedApplications] };
  }

  public async update(configuration: StreamingConfiguration): Promise<StreamingConfiguration> {
    this.#configuration = this.#validator.validate(configuration);
    await this.#store.write(this.#configuration);
    return this.get();
  }
}
