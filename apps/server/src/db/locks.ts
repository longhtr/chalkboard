/**
 * PostgreSQL advisory-lock names. Migrations serialize schema changes, while
 * the runtime lock prevents two processes from claiming in-memory room ownership.
 */
/** Serializes migration inspection and application across processes. */
export const MIGRATION_LOCK_NAME = 'chalkboard:schema-migrations';
/** Enforces the single in-memory collaboration-room owner. */
export const RUNTIME_LOCK_NAME = 'chalkboard:single-collaboration-server';
