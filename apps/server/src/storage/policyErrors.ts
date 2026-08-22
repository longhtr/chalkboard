/** Stable domain errors translated from PostgreSQL policy trigger failures. */
import { readUnknownProperty } from '../operations/errorDiagnostics.js';
type StoragePolicyCode =
  | 'account_asset_quota_exceeded'
  | 'account_board_quota_exceeded'
  | 'board_membership_partition_mismatch'
  | 'board_yjs_quota_exceeded'
  | 'demo_asset_quota_exceeded'
  | 'demo_board_quota_exceeded'
  | 'demo_yjs_quota_exceeded'
  | 'global_board_quota_exceeded'
  | 'global_content_quota_exceeded'
  | 'global_demo_content_quota_exceeded';

const STORAGE_POLICY_CODES = new Set<StoragePolicyCode>([
  'account_asset_quota_exceeded',
  'account_board_quota_exceeded',
  'board_membership_partition_mismatch',
  'board_yjs_quota_exceeded',
  'demo_asset_quota_exceeded',
  'demo_board_quota_exceeded',
  'demo_yjs_quota_exceeded',
  'global_board_quota_exceeded',
  'global_content_quota_exceeded',
  'global_demo_content_quota_exceeded',
]);

/** A server policy rejection that callers may safely map without leaking SQL. */
export class StoragePolicyError extends Error {
  constructor(readonly policyCode: StoragePolicyCode) {
    super(policyCode);
    this.name = 'StoragePolicyError';
  }
}

/** Converts only known trigger messages; unknown database errors remain intact. */
export function translateStoragePolicyError(error: unknown): never {
  const code = readUnknownProperty(error, 'code');
  const message = readUnknownProperty(error, 'message');
  if (
    code === 'P0001' &&
    typeof message === 'string' &&
    STORAGE_POLICY_CODES.has(message as StoragePolicyCode)
  ) {
    throw new StoragePolicyError(message as StoragePolicyCode);
  }
  throw error;
}
