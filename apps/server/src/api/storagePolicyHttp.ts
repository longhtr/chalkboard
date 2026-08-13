import type { FastifyReply } from 'fastify';

import { isErrorInstance } from '../operations/errorDiagnostics.js';
import { StoragePolicyError } from '../storage/policyErrors.js';

/** Maps known storage-policy rejections without exposing internal counters or SQL. */
export function storagePolicyResponse(
  reply: FastifyReply,
  error: unknown,
): FastifyReply | null {
  if (!isErrorInstance(error, StoragePolicyError)) return null;
  if (error.policyCode === 'board_membership_partition_mismatch') {
    return reply.code(403).send({ error: 'Board sharing is not available' });
  }
  return reply.code(409).send({
    error: 'Storage limit reached. Remove existing content and try again.',
  });
}
