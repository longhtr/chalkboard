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
  postgresMigration: '0009_maintenance_cleanup_indexes.sql',
} as const;

/** Build identity and public schema set exposed for compatibility diagnostics. */
export interface ApplicationDiagnostics {
  commit: string;
  demo: {
    accountCount: number | null;
    boardCount: number | null;
    contentBytes: number | null;
    lastResetAt: string | null;
    resetHealth: 'healthy' | 'overdue' | 'unavailable';
    sessionCount: number | null;
  };
  email: {
    delivery: 'development' | 'ses' | 'unavailable';
    flowStatusAvailable: boolean;
    flows: {
      emailChange: boolean;
      passwordReset: boolean;
      registration: boolean;
    };
    humanVerification: 'development' | 'turnstile' | 'unavailable';
    material: 'development' | 'materialized' | 'unavailable';
    verifiedAccountCount: number | null;
    verifiedAccountLimit: number | null;
  };
  name: 'Chalkboard';
  schemas: typeof CHALKBOARD_SCHEMA_VERSIONS;
  version: string;
}
