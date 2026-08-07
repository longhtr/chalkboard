/**
 * Stable health and diagnostic response contracts. Liveness means the process
 * can answer; readiness additionally means it may receive application traffic.
 */
export const SERVICE_NAME = 'chalkboard-server' as const;

/** Process-liveness response; it does not promise dependency readiness. */
export interface LiveHealthResponse {
  service: typeof SERVICE_NAME;
  status: 'ok';
  timestamp: string;
}

/** Readiness response emitted when the server may admit application traffic. */
export interface ReadyHealthResponse {
  service: typeof SERVICE_NAME;
  status: 'ready';
  timestamp: string;
}

/** Readiness response emitted while the server must reject application traffic. */
export interface NotReadyHealthResponse {
  service: typeof SERVICE_NAME;
  status: 'not_ready';
  timestamp: string;
}

/** Complete discriminated response union for the readiness endpoint. */
export type ReadinessResponse = ReadyHealthResponse | NotReadyHealthResponse;
