import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { StreamConfigurationService } from '../src/main/configuration/StreamConfigurationService';
import {
  HdrMode,
  StreamingConfigurationDefaults,
  VideoCodec
} from '../src/shared/StreamingConfigurationContracts';

class StreamConfigurationTestSuite {
  readonly #temporaryDirectories: string[] = [];

  public register(): void {
    describe('stream configuration', () => {
      afterEach(async () => this.dispose());

      test('persists explicit stable settings and normalizes protected applications', async () => {
        const directory = await this.createDirectory();
        const service = new StreamConfigurationService(directory);
        await service.load();
        const updated = await service.update({
          ...StreamingConfigurationDefaults.stableGaming(),
          codec: VideoCodec.Hevc,
          hdrMode: HdrMode.Automatic,
          maximumBitrateMbps: 42.4,
          protectedApplications: ['League of Legends.exe', '', 'League of Legends.exe']
        });
        expect(updated.maximumBitrateMbps).toBe(42);
        expect(updated.protectedApplications).toEqual(['League of Legends.exe']);

        const reloadedService = new StreamConfigurationService(directory);
        await reloadedService.load();
        expect(reloadedService.get()).toEqual(updated);
      });

      test('rejects mismatched resolutions and an inverted frame-rate range', async () => {
        const service = new StreamConfigurationService(await this.createDirectory());
        await expect(service.update({
          ...StreamingConfigurationDefaults.stableGaming(),
          targetWidth: 1920,
          targetHeight: 720
        })).rejects.toThrow('resolution');
        await expect(service.update({
          ...StreamingConfigurationDefaults.stableGaming(),
          targetFramesPerSecond: 30,
          minimumFramesPerSecond: 60
        })).rejects.toThrow('cannot exceed');
      });
    });
  }

  private async createDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'istream-config-test-'));
    this.#temporaryDirectories.push(directory);
    return directory;
  }

  private async dispose(): Promise<void> {
    await Promise.all(this.#temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    this.#temporaryDirectories.length = 0;
  }
}

new StreamConfigurationTestSuite().register();
