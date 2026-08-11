import {
  DiagnosticCategory,
  DiagnosticDefaults,
  DiagnosticSeverity,
  type DiagnosticRecord,
  type DiagnosticValue
} from '../../shared/DiagnosticContracts';

export class DiagnosticRecordValidator {
  public validate(value: unknown): DiagnosticRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Diagnostic record must be an object.');
    }
    const candidate = value as Partial<DiagnosticRecord>;
    if (
      candidate.schemaVersion !== DiagnosticDefaults.schemaVersion ||
      !Number.isSafeInteger(candidate.sequence) ||
      (candidate.sequence ?? -1) < 0 ||
      !Number.isFinite(candidate.timestamp) ||
      !this.text(candidate.originDeviceId, 32) ||
      !this.text(candidate.originDisplayName, 64) ||
      !Object.values(DiagnosticCategory).includes(candidate.category as DiagnosticCategory) ||
      !Object.values(DiagnosticSeverity).includes(candidate.severity as DiagnosticSeverity) ||
      !this.text(candidate.event, 96) ||
      typeof candidate.values !== 'object' ||
      candidate.values === null ||
      Array.isArray(candidate.values)
    ) {
      throw new Error('Diagnostic record header is invalid.');
    }
    const entries = Object.entries(candidate.values);
    if (
      entries.length > DiagnosticDefaults.maximumValuesPerRecord ||
      entries.some(([key, entryValue]) => !this.text(key, 64) || !this.diagnosticValue(entryValue))
    ) {
      throw new Error('Diagnostic record values are invalid.');
    }
    return candidate as DiagnosticRecord;
  }

  private diagnosticValue(value: unknown): value is DiagnosticValue {
    return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  }

  private text(value: unknown, maximumLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
  }
}
