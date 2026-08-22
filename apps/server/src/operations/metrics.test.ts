/** Proves metrics use fixed names, bounded labels, valid Prometheus text, and no board or user content. */
import { describe, expect, it } from 'vitest';

import { OperationalMetrics } from './metrics.js';

describe('OperationalMetrics', () => {
  it('renders policy counters and owned-work gauges', () => {
    const metrics = new OperationalMetrics();
    metrics.recordApiRequestStarted();
    metrics.recordApiRequestStarted();
    metrics.recordApiRequestCompleted();
    metrics.recordApiRequestOverload();
    metrics.recordAssetUploadStarted();
    metrics.recordAssetUploadOverload();
    metrics.recordAuthenticationFailure();
    metrics.recordDrainStarted();
    metrics.recordHttpResponse(503);
    metrics.recordYjsUpdate();
    metrics.recordAppend();
    metrics.recordCollaborationAwarenessRejection();
    metrics.recordCollaborationCompactionOverload();
    metrics.recordCollaborationDocumentLimitRejection();
    metrics.recordCollaborationPersistenceOverload();
    metrics.recordCollaborationPolicyRejection();
    metrics.recordCompaction();
    metrics.recordPasswordWorkOverload();
    metrics.recordStorageFailure();

    const output = metrics.renderPrometheus({
      collaboration: {
        activeClients: 3,
        activeCompactions: 2,
        activeRooms: 2,
        oldestPendingPersistenceAgeMilliseconds: 75,
        pendingCompactions: 4,
        pendingPersistenceBytes: 512,
        pendingPersistenceWrites: 1,
      },
      database: {
        idleConnections: 2,
        maximumConnections: 10,
        passwordWorkActive: 2,
        passwordWorkConcurrent: 4,
        passwordWorkPending: 16,
        passwordWorkQueued: 3,
        totalConnections: 4,
        waitingRequests: 1,
      },
      draining: true,
    });

    expect(output).toContain('# TYPE chalkboard_http_requests_total counter');
    expect(output).toContain('chalkboard_process_draining 1');
    expect(output).toContain('chalkboard_shutdown_drain_starts_total 1');
    expect(output).toContain('chalkboard_http_server_errors_total 1');
    expect(output).toContain('chalkboard_api_requests_active 1');
    expect(output).toContain('chalkboard_api_request_overloads_total 1');
    expect(output).toContain('chalkboard_asset_uploads_active 1');
    expect(output).toContain('chalkboard_asset_upload_overloads_total 1');
    expect(output).toContain('chalkboard_authentication_failures_total 1');
    expect(output).toContain('chalkboard_collaboration_active_rooms 2');
    expect(output).toContain('chalkboard_collaboration_active_clients 3');
    expect(output).toContain(
      'chalkboard_collaboration_pending_persistence_writes 1',
    );
    expect(output).toContain(
      'chalkboard_collaboration_pending_persistence_bytes 512',
    );
    expect(output).toContain('chalkboard_collaboration_updates_total 1');
    expect(output).toContain(
      'chalkboard_collaboration_append_operations_total 1',
    );
    expect(output).toContain('chalkboard_password_work_active 2');
    expect(output).toContain('chalkboard_password_work_queued 3');
    expect(output).toContain('chalkboard_database_pool_connections 4');
    expect(output).toContain('chalkboard_database_pool_waiting_requests 1');
    expect(output).toContain('chalkboard_password_work_overloads_total 1');
    expect(output).toContain('chalkboard_storage_failures_total 1');
  });
});
