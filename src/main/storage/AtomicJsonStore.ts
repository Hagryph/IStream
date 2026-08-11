import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class AtomicJsonStore<TValue> {
  readonly #filePath: string;

  public constructor(filePath: string) {
    this.#filePath = filePath;
  }

  public async read(): Promise<TValue | null> {
    try {
      return JSON.parse(await readFile(this.#filePath, 'utf8')) as TValue;
    } catch (error: unknown) {
      if (this.isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  public async write(value: TValue): Promise<void> {
    const temporaryPath = `${this.#filePath}.tmp`;
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.#filePath);
  }

  private isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}
