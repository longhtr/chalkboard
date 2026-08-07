/**
 * Public format versions reported by diagnostics and checked at persistence or
 * import boundaries. Increment only the format whose reader/writer changed.
 */
export const CHALKBOARD_SCHEMA_VERSIONS = {
  archive: 1,
  archiveBoard: 1,
  cloudBoard: 1,
  indexedDb: 5,
  localBoardRecord: 2,
  mixedContent: 1,
  postgresMigration: '0005_email_verification.sql',
} as const;

/** Build identity and public schema set exposed for compatibility diagnostics. */
export interface ApplicationDiagnostics {
  commit: string;
  name: 'Chalkboard';
  schemas: typeof CHALKBOARD_SCHEMA_VERSIONS;
  version: string;
}
