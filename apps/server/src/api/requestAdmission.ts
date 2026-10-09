/**
 * Applies finite process-capacity admission before API handlers run. General
 * JSON work and image uploads use separate pools so expensive uploads cannot
 * consume every slot needed for sessions and board commands.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { OperationalMetrics } from '../operations/metrics.js';

interface AdmissionPolicy {
  concurrent: number;
  error: string;
  matches(request: FastifyRequest): boolean;
  onCompleted(): void;
  onOverload(): void;
  onStarted(): void;
}

function installRequestAdmission(
  app: FastifyInstance,
  policy: AdmissionPolicy,
): void {
  const admitted = new WeakSet<FastifyRequest>();
  let active = 0;
  const release = (request: FastifyRequest) => {
    if (!admitted.delete(request)) return;
    active -= 1;
    policy.onCompleted();
  };

  app.addHook('onRequest', async (request, reply) => {
    if (!policy.matches(request)) return;
    if (active >= policy.concurrent) {
      policy.onOverload();
      return reply
        .header('retry-after', '1')
        .code(503)
        .send({ error: policy.error });
    }
    active += 1;
    admitted.add(request);
    policy.onStarted();
  });
  app.addHook('onResponse', (request, _reply, done) => {
    release(request);
    done();
  });
  app.addHook('onRequestAbort', (request, done) => {
    release(request);
    done();
  });
}

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? request.url;
}

function isApiRequest(request: FastifyRequest): boolean {
  const path = requestPath(request);
  return path === '/api' || path.startsWith('/api/');
}

function isAssetUpload(request: FastifyRequest): boolean {
  if (request.method !== 'POST') return false;
  const segments = requestPath(request).split('/');
  return (
    segments.length === 5 &&
    segments[1] === 'api' &&
    segments[2] === 'boards' &&
    segments[3] !== '' &&
    segments[4] === 'assets'
  );
}

/** Installs independent finite-capacity gates for API work and asset uploads. */
export function installApiCapacityAdmission(
  app: FastifyInstance,
  options: {
    apiRequests: number;
    assetUploads: number | null;
    metrics: OperationalMetrics;
  },
): void {
  const { metrics } = options;
  installRequestAdmission(app, {
    concurrent: options.apiRequests,
    error: 'API capacity is busy. Try again shortly.',
    matches: isApiRequest,
    onCompleted: () => metrics.recordApiRequestCompleted(),
    onOverload: () => metrics.recordApiRequestOverload(),
    onStarted: () => metrics.recordApiRequestStarted(),
  });
  if (options.assetUploads === null) return;
  installRequestAdmission(app, {
    concurrent: options.assetUploads,
    error: 'Image upload capacity is busy. Try again shortly.',
    matches: isAssetUpload,
    onCompleted: () => metrics.recordAssetUploadCompleted(),
    onOverload: () => metrics.recordAssetUploadOverload(),
    onStarted: () => metrics.recordAssetUploadStarted(),
  });
}
