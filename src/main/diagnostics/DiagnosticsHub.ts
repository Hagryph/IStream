import {
  DiagnosticDefaults,
  DiagnosticEventSource,
  type CollectedDiagnosticRecord,
  type DiagnosticRecord
} from '../../shared/DiagnosticContracts';

export type DiagnosticsHubListener = (record: CollectedDiagnosticRecord) => void;

export class DiagnosticsHub {
  readonly #recordLimit: number;
  readonly #listeners: Set<DiagnosticsHubListener> = new Set<DiagnosticsHubListener>();
  readonly #records: CollectedDiagnosticRecord[] = [];

  public constructor(recordLimit: number = DiagnosticDefaults.retainedRecordLimit) {
    this.#recordLimit = recordLimit;
  }

  public publish(record: DiagnosticRecord, source: DiagnosticEventSource): void {
    const collected: CollectedDiagnosticRecord = {
      receivedAt: Date.now(),
      source,
      record
    };
    this.#records.push(collected);
    while (this.#records.length > this.#recordLimit) {
      this.#records.shift();
    }
    for (const listener of this.#listeners) {
      listener(collected);
    }
  }

  public snapshot(): readonly CollectedDiagnosticRecord[] {
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
}
