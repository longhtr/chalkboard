/**
 * Authorized image upload/download HTTP boundary. Uploads use a byte parser
 * with a tighter limit, validate content before persistence, and return only
 * immutable board-scoped references.
 */
import type { FastifyInstance } from 'fastify';

import type { AccountService } from '../accounts/service.js';
import { authenticatedUser } from '../api/authenticatedUser.js';
import { storagePolicyResponse } from '../api/storagePolicyHttp.js';
import { isErrorInstance } from '../operations/errorDiagnostics.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import type { AssetService } from './service.js';
import {
  AssetValidationError,
  MAX_ASSET_BYTES,
  SUPPORTED_ASSET_MEDIA_TYPES,
  validateAsset,
} from './validation.js';

/** Installs authorized upload and download routes for immutable board images. */
export function installAssetRoutes(
  app: FastifyInstance,
  {
    accounts,
    assets,
    metrics,
  }: {
    accounts: AccountService;
    assets: AssetService;
    metrics: OperationalMetrics;
  },
): void {
  app.addContentTypeParser(
    [...SUPPORTED_ASSET_MEDIA_TYPES],
    { bodyLimit: MAX_ASSET_BYTES, parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.post<{ Body: Buffer; Params: { id: string } }>(
    '/api/boards/:id/assets',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: 'An image body is required' });
      }

      const mediaType = request.headers['content-type']
        ?.split(';')[0]
        ?.trim()
        .toLowerCase();
      const nameHeader = request.headers['x-file-name'];
      let name: string | undefined;
      if (typeof nameHeader === 'string') {
        try {
          name = decodeURIComponent(nameHeader);
        } catch {
          name = nameHeader;
        }
      }

      try {
        const asset = validateAsset({
          content: request.body,
          mediaType: mediaType ?? '',
          ...(name === undefined ? {} : { name }),
        });
        const stored = await assets.upload(user.id, request.params.id, asset);
        if (stored === null) {
          return reply.code(403).send({ error: 'Edit access required' });
        }
        return reply.code(201).send({
          asset: {
            ...stored,
            url: `/api/boards/${stored.boardId}/assets/${stored.id}`,
          },
        });
      } catch (error) {
        if (isErrorInstance(error, AssetValidationError)) {
          return reply.code(400).send({ error: error.message });
        }
        const response = storagePolicyResponse(reply, error);
        if (response !== null) return response;
        metrics.recordStorageFailure();
        throw error;
      }
    },
  );

  app.get<{ Params: { assetId: string; id: string } }>(
    '/api/boards/:id/assets/:assetId',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const asset = await assets.get(
        user.id,
        request.params.id,
        request.params.assetId,
      );
      if (asset === null) {
        return reply.code(404).send({ error: 'Asset not found' });
      }
      return reply
        .header('cache-control', 'private, no-store')
        .header('content-length', String(asset.byteSize))
        .header(
          'content-security-policy',
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        )
        .type(asset.mediaType)
        .send(asset.content);
    },
  );
}
