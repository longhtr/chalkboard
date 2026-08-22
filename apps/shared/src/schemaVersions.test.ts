/** Locks every externally visible format version and the latest PostgreSQL migration identity. */
import { describe, expect, it } from 'vitest';

import { CHALKBOARD_SCHEMA_VERSIONS } from './schemaVersions';

describe('application schema diagnostics', () => {
  it('names every independently versioned persistence boundary', () => {
    expect(CHALKBOARD_SCHEMA_VERSIONS).toEqual({
      archive: 1,
      archiveBoard: 1,
      cloudBoard: 1,
      indexedDb: 5,
      localBoardRecord: 2,
      mixedContent: 1,
      postgresMigration: '0010_capacity_board_ceiling.sql',
    });
  });
});
