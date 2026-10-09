/** Locks the service name used by typed health responses and operational probes. */
import { describe, expect, it } from 'vitest';

import { SERVICE_NAME } from './health';

describe('shared health contract', () => {
  it('uses a stable service name', () => {
    expect(SERVICE_NAME).toBe('chalkboard-server');
  });
});
