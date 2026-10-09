/**
 * Holds synthetic requests open to prove API and asset-upload capacity pools
 * admit, queue, reject, time out, and release independently.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationalMetrics } from '../operations/metrics.js';
import { installApiCapacityAdmission } from './requestAdmission.js';

const BOARD_ID = '11111111-1111-4111-8111-111111111111';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: () => resolve?.() };
}

describe('request admission', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('bounds API requests while health traffic remains available', async () => {
    const gate = deferred();
    const app = Fastify({ logger: false });
    apps.push(app);
    const metrics = new OperationalMetrics();
    const completed = vi.spyOn(metrics, 'recordApiRequestCompleted');
    const overloaded = vi.spyOn(metrics, 'recordApiRequestOverload');
    const started = vi.spyOn(metrics, 'recordApiRequestStarted');
    installApiCapacityAdmission(app, {
      apiRequests: 2,
      assetUploads: null,
      metrics,
    });
    app.get('/api/items', async () => {
      await gate.promise;
      return { items: [] };
    });
    app.get('/health/live', async () => ({ status: 'ok' }));

    const first = app.inject({ method: 'GET', url: '/api/items' });
    const second = app.inject({ method: 'GET', url: '/api/items' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const overflow = await app.inject({
      method: 'GET',
      url: '/api/items?source=fuzz',
    });
    const health = await app.inject({ method: 'GET', url: '/health/live' });

    expect(overflow.statusCode).toBe(503);
    expect(overflow.headers['retry-after']).toBe('1');
    expect(health.statusCode).toBe(200);
    expect(started).toHaveBeenCalledTimes(2);
    expect(overloaded).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([first, second]);
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it('bounds asset uploads independently from other API work', async () => {
    const gate = deferred();
    const app = Fastify({ logger: false });
    apps.push(app);
    const metrics = new OperationalMetrics();
    const completed = vi.spyOn(metrics, 'recordAssetUploadCompleted');
    const overloaded = vi.spyOn(metrics, 'recordAssetUploadOverload');
    const started = vi.spyOn(metrics, 'recordAssetUploadStarted');
    installApiCapacityAdmission(app, {
      apiRequests: 10,
      assetUploads: 2,
      metrics,
    });
    app.post('/api/boards/:boardId/assets', async () => {
      await gate.promise;
      return { uploaded: true };
    });

    const url = `/api/boards/${BOARD_ID}/assets`;
    const first = app.inject({ method: 'POST', url });
    const second = app.inject({ method: 'POST', url });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const overflow = await app.inject({ method: 'POST', url });

    expect(overflow.statusCode).toBe(503);
    expect(overflow.headers['retry-after']).toBe('1');
    expect(started).toHaveBeenCalledTimes(2);
    expect(overloaded).toHaveBeenCalledOnce();
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { statusCode: 200 },
      { statusCode: 200 },
    ]);
    expect(completed).toHaveBeenCalledTimes(2);
  });
});
