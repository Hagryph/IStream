import {
  DiagnosticDefaults,
  DiagnosticEventSource,
  type CollectedDiagnosticRecord,
  type DiagnosticRecord
} from '../../shared/DiagnosticContracts';

export type DiagnosticsHubListener = (record: CollectedDiagnosticRecord) => void;
export type DiagnosticsClock = () => number;

export class DiagnosticsHub {
  readonly #recordLimit: number;
  readonly #retentionDurationMs: number;
  readonly #clock: DiagnosticsClock;
  readonly #listeners: Set<DiagnosticsHubListener> = new Set<DiagnosticsHubListener>();
  readonly #records: CollectedDiagnosticRecord[] = [];

  public constructor(
    recordLimit: number = DiagnosticDefaults.retainedRecordLimit,
    retentionDurationMs: number = DiagnosticDefaults.retainedDurationMs,
    clock: DiagnosticsClock = Date.now
  ) {
    if (!Number.isSafeInteger(recordLimit) || recordLimit < 1) {
      throw new Error('Diagnostic record limit must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(retentionDurationMs) || retentionDurationMs < 1) {
      throw new Error('Diagnostic retention duration must be a positive safe integer.');
    }
    this.#recordLimit = recordLimit;
    this.#retentionDurationMs = retentionDurationMs;
    this.#clock = clock;
  }

  public publish(record: DiagnosticRecord, source: DiagnosticEventSource): void {
    const receivedAt = this.#clock();
    const collected: CollectedDiagnosticRecord = {
      receivedAt,
      source,
      record
    };
    this.#records.push(collected);
    this.prune(receivedAt);
    for (const listener of this.#listeners) {
      listener(collected);
    }
  }

  public snapshot(): readonly CollectedDiagnosticRecord[] {
    this.prune(this.#clock());
    return this.#records.map((record) => ({
      ...record,
      record: { ...record.record, values: { ...record.record.values } }
    }));
  }

  public subscribe(listener: DiagnosticsHubListener): () => void {
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  private prune(now: number): void {
    const oldestRetainedTimestamp = now - this.#retentionDurationMs;
    while (this.#records.length > 0 && (this.#records[0]?.receivedAt ?? now) < oldestRetainedTimestamp) {
      this.#records.shift();
    }
    while (this.#records.length > this.#recordLimit) {
      this.#records.shift();
    }
  }
}
