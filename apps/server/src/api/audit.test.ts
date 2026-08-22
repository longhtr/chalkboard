/** Proves audit output contains allowed identifiers while omitting headers, bodies, tokens, and secrets. */
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { writeSecurityAuditEvent } from './audit.js';

describe('security audit events', () => {
  it('writes a structured event with request context and no credential fields', () => {
    const info = vi.fn();
    writeSecurityAuditEvent(
      {
        id: 'request-7',
        ip: '192.0.2.10',
        log: { info } as unknown as FastifyBaseLogger,
      },
      {
        action: 'session.login',
        actorUserId: 'user-1',
        outcome: 'succeeded',
      },
    );

    expect(info).toHaveBeenCalledWith(
      {
        audit: {
          action: 'session.login',
          actorUserId: 'user-1',
          outcome: 'succeeded',
          requestId: 'request-7',
          sourceIp: '192.0.2.10',
        },
      },
      'Security audit event',
    );
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toMatch(/email|password|token/u);
  });
});
