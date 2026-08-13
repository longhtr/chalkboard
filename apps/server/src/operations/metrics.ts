/**
 * Fixed-cardinality operational metrics and Prometheus rendering. Labels are
 * closed enums or status classes; user IDs, board IDs, titles, and content are
 * intentionally absent.
 */
import type { DatabaseMetricsSnapshot } from '../db/database.js';

/** Point-in-time room, peer, compaction, and persistence occupancy. */
export interface CollaborationMetricsSnapshot {
  activeClients: number;
  activeCompactions: number;
  activeRooms: number;
  oldestPendingPersistenceAgeMilliseconds: number;
  pendingCompactions: number;
  pendingPersistenceBytes: number;
  pendingPersistenceWrites: number;
}

const EMPTY_DATABASE_METRICS: DatabaseMetricsSnapshot = {
  idleConnections: 0,
  maximumConnections: 0,
  passwordWorkActive: 0,
  passwordWorkConcurrent: 0,
  passwordWorkPending: 0,
  passwordWorkQueued: 0,
  totalConnections: 0,
  waitingRequests: 0,
};

type Metric = [
  name: string,
  help: string,
  type: 'counter' | 'gauge',
  value: number,
];

function render(metrics: Metric[]): string {
  return metrics
    .map(
      ([name, help, type, value]) =>
        `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`,
    )
    .join('\n');
}

/**
 * Records safety and durability state. Every counter corresponds to a policy
 * decision; every gauge describes work currently owned by this process.
 */
export class OperationalMetrics {
  private apiRequestOverloads = 0;
  private apiRequestsActive = 0;
  private appendOperations = 0;
  private assetUploadOverloads = 0;
  private assetUploadsActive = 0;
  private authenticationFailures = 0;
  private collaborationAwarenessRejections = 0;
  private collaborationCompactionOverloads = 0;
  private collaborationDocumentLimitRejections = 0;
  private collaborationPersistenceOverloads = 0;
  private collaborationPolicyRejections = 0;
  private compactions = 0;
  private drainStarts = 0;
  private httpRequests = 0;
  private httpServerErrors = 0;
  private passwordWorkOverloads = 0;
  private storageFailures = 0;
  private yjsUpdates = 0;

  recordApiRequestCompleted(): void {
    this.apiRequestsActive = Math.max(0, this.apiRequestsActive - 1);
  }

  recordApiRequestOverload(): void {
    this.apiRequestOverloads += 1;
  }

  recordApiRequestStarted(): void {
    this.apiRequestsActive += 1;
  }

  recordAppend(): void {
    this.appendOperations += 1;
  }

  recordAssetUploadCompleted(): void {
    this.assetUploadsActive = Math.max(0, this.assetUploadsActive - 1);
  }

  recordAssetUploadOverload(): void {
    this.assetUploadOverloads += 1;
  }

  recordAssetUploadStarted(): void {
    this.assetUploadsActive += 1;
  }

  recordAuthenticationFailure(): void {
    this.authenticationFailures += 1;
  }

  recordCollaborationAwarenessRejection(): void {
    this.collaborationAwarenessRejections += 1;
  }

  recordCollaborationCompactionOverload(): void {
    this.collaborationCompactionOverloads += 1;
  }

  recordCollaborationDocumentLimitRejection(): void {
    this.collaborationDocumentLimitRejections += 1;
  }

  recordCollaborationPersistenceOverload(): void {
    this.collaborationPersistenceOverloads += 1;
  }

  recordCollaborationPolicyRejection(): void {
    this.collaborationPolicyRejections += 1;
  }

  recordCompaction(): void {
    this.compactions += 1;
  }

  recordDrainStarted(): void {
    this.drainStarts += 1;
  }

  recordHttpResponse(statusCode: number): void {
    this.httpRequests += 1;
    if (statusCode >= 500) this.httpServerErrors += 1;
  }

  recordPasswordWorkOverload(): void {
    this.passwordWorkOverloads += 1;
  }

  recordStorageFailure(): void {
    this.storageFailures += 1;
  }

  recordYjsUpdate(): void {
    this.yjsUpdates += 1;
  }

  renderPrometheus(options: {
    collaboration: CollaborationMetricsSnapshot;
    database?: DatabaseMetricsSnapshot | undefined;
    draining: boolean;
  }): string {
    const {
      collaboration,
      database = EMPTY_DATABASE_METRICS,
      draining,
    } = options;
    return `${render([
      [
        'chalkboard_process_draining',
        'Whether shutdown drain has started.',
        'gauge',
        draining ? 1 : 0,
      ],
      [
        'chalkboard_shutdown_drain_starts_total',
        'Shutdown drains started.',
        'counter',
        this.drainStarts,
      ],
      [
        'chalkboard_http_requests_total',
        'Completed HTTP requests.',
        'counter',
        this.httpRequests,
      ],
      [
        'chalkboard_http_server_errors_total',
        'HTTP responses with a 5xx status.',
        'counter',
        this.httpServerErrors,
      ],
      [
        'chalkboard_api_requests_active',
        'API requests currently admitted.',
        'gauge',
        this.apiRequestsActive,
      ],
      [
        'chalkboard_api_request_overloads_total',
        'API requests rejected by admission.',
        'counter',
        this.apiRequestOverloads,
      ],
      [
        'chalkboard_asset_uploads_active',
        'Asset uploads currently admitted.',
        'gauge',
        this.assetUploadsActive,
      ],
      [
        'chalkboard_asset_upload_overloads_total',
        'Asset uploads rejected by admission.',
        'counter',
        this.assetUploadOverloads,
      ],
      [
        'chalkboard_authentication_failures_total',
        'Rejected authentication attempts.',
        'counter',
        this.authenticationFailures,
      ],
      [
        'chalkboard_collaboration_active_rooms',
        'Loaded collaboration rooms.',
        'gauge',
        collaboration.activeRooms,
      ],
      [
        'chalkboard_collaboration_active_clients',
        'Connected collaboration clients.',
        'gauge',
        collaboration.activeClients,
      ],
      [
        'chalkboard_collaboration_awareness_rejections_total',
        'Rejected Awareness updates.',
        'counter',
        this.collaborationAwarenessRejections,
      ],
      [
        'chalkboard_collaboration_policy_rejections_total',
        'Rejected collaboration messages or connections.',
        'counter',
        this.collaborationPolicyRejections,
      ],
      [
        'chalkboard_collaboration_document_limit_rejections_total',
        'Rejected Yjs updates or documents.',
        'counter',
        this.collaborationDocumentLimitRejections,
      ],
      [
        'chalkboard_collaboration_compaction_overloads_total',
        'Compactions rejected by admission.',
        'counter',
        this.collaborationCompactionOverloads,
      ],
      [
        'chalkboard_collaboration_persistence_overloads_total',
        'Updates rejected by persistence admission.',
        'counter',
        this.collaborationPersistenceOverloads,
      ],
      [
        'chalkboard_collaboration_pending_persistence_writes',
        'Updates awaiting durable persistence.',
        'gauge',
        collaboration.pendingPersistenceWrites,
      ],
      [
        'chalkboard_collaboration_pending_persistence_bytes',
        'Update bytes awaiting durable persistence.',
        'gauge',
        collaboration.pendingPersistenceBytes,
      ],
      [
        'chalkboard_collaboration_oldest_pending_persistence_age_milliseconds',
        'Age of the oldest pending update.',
        'gauge',
        collaboration.oldestPendingPersistenceAgeMilliseconds,
      ],
      [
        'chalkboard_collaboration_updates_total',
        'Yjs updates accepted by this process.',
        'counter',
        this.yjsUpdates,
      ],
      [
        'chalkboard_collaboration_active_compactions',
        'Snapshot compactions currently running.',
        'gauge',
        collaboration.activeCompactions,
      ],
      [
        'chalkboard_collaboration_pending_compactions',
        'Snapshot compactions awaiting admission.',
        'gauge',
        collaboration.pendingCompactions,
      ],
      [
        'chalkboard_collaboration_compactions_total',
        'Completed snapshot compactions.',
        'counter',
        this.compactions,
      ],
      [
        'chalkboard_collaboration_append_operations_total',
        'Completed durable update appends.',
        'counter',
        this.appendOperations,
      ],
      [
        'chalkboard_password_work_overloads_total',
        'Password work rejected by admission.',
        'counter',
        this.passwordWorkOverloads,
      ],
      [
        'chalkboard_storage_failures_total',
        'Collaboration or asset persistence failures.',
        'counter',
        this.storageFailures,
      ],
      [
        'chalkboard_password_work_active',
        'Password operations currently running.',
        'gauge',
        database.passwordWorkActive,
      ],
      [
        'chalkboard_password_work_max_active',
        'Maximum concurrent password operations.',
        'gauge',
        database.passwordWorkConcurrent,
      ],
      [
        'chalkboard_password_work_queued',
        'Password operations awaiting execution.',
        'gauge',
        database.passwordWorkQueued,
      ],
      [
        'chalkboard_password_work_max_queued',
        'Maximum queued password operations.',
        'gauge',
        database.passwordWorkPending,
      ],
      [
        'chalkboard_database_pool_max_connections',
        'Maximum PostgreSQL connections.',
        'gauge',
        database.maximumConnections,
      ],
      [
        'chalkboard_database_pool_connections',
        'Current PostgreSQL connections.',
        'gauge',
        database.totalConnections,
      ],
      [
        'chalkboard_database_pool_idle_connections',
        'Idle PostgreSQL connections.',
        'gauge',
        database.idleConnections,
      ],
      [
        'chalkboard_database_pool_waiting_requests',
        'Requests awaiting a PostgreSQL connection.',
        'gauge',
        database.waitingRequests,
      ],
    ])}\n`;
  }
}
