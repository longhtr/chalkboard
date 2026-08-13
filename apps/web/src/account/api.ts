/**
 * Bounded same-origin JSON transport and runtime response boundary. Every
 * successful payload is reconstructed by an explicit decoder before application
 * state may use it; transport, HTTP, timeout, and shape failures become `ApiError`.
 */
import type {
  AccountUser,
  BoardInviteLink as SharedBoardInviteLink,
  BoardMember as SharedBoardMember,
  BoardRole,
  TrashedBoardSummary,
} from '@chalkboard/shared';

const API_REQUEST_TIMEOUT_MS = 30_000;
const INVALID_RESPONSE_MESSAGE = 'Chalkboard returned an invalid response';

/** Authenticated user projection returned by account endpoints. */
export type User = AccountUser;
/** Authorized invitation metadata without its one-time secret token. */
export type BoardInviteLink = SharedBoardInviteLink;
/** Authorized board-member projection. */
export type BoardMember = SharedBoardMember;
/** Cloud-board metadata retained while reversible deletion is active. */
export type TrashedCloudBoardSummary = TrashedBoardSummary;

/** Board list/detail projection with the current user's effective role. */
export interface Board {
  id: string;
  role: BoardRole;
  title: string;
  updatedAt: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

/** Normalized transport, timeout, HTTP, or response-validation failure. */
export class ApiError extends Error {
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    status: number | null,
    options?: ErrorOptions & { requestId?: string | null },
  ) {
    const requestId =
      options?.requestId !== undefined &&
      options.requestId !== null &&
      REQUEST_ID_PATTERN.test(options.requestId)
        ? options.requestId
        : null;
    super(
      requestId === null ? message : `${message} Reference: ${requestId}.`,
      options,
    );
    this.name = 'ApiError';
    this.requestId = requestId;
    this.status = status;
  }
}

function responseRequestId(response: Response): string | null {
  const candidate = response.headers.get('x-request-id');
  return candidate !== null && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : null;
}

/** Runtime validator that reconstructs one trusted API response value. */
type ApiResponseDecoder<T> = (value: unknown) => T;

type ApiJsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is ApiJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): ApiJsonObject {
  if (!isJsonObject(value)) throw new TypeError(INVALID_RESPONSE_MESSAGE);
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(INVALID_RESPONSE_MESSAGE);
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError(INVALID_RESPONSE_MESSAGE);
  return value;
}

function boardRole(value: unknown): BoardRole {
  if (value !== 'owner' && value !== 'editor' && value !== 'viewer') {
    throw new TypeError(INVALID_RESPONSE_MESSAGE);
  }
  return value;
}

function inviteRole(value: unknown): 'editor' | 'viewer' {
  if (value !== 'editor' && value !== 'viewer') {
    throw new TypeError(INVALID_RESPONSE_MESSAGE);
  }
  return value;
}

function array<T>(value: unknown, decode: ApiResponseDecoder<T>): T[] {
  if (!Array.isArray(value)) throw new TypeError(INVALID_RESPONSE_MESSAGE);
  return value.map(decode);
}

function decodeUser(value: unknown): User {
  const user = object(value);
  return {
    displayName: string(user.displayName),
    email: string(user.email),
    id: string(user.id),
    isDemo: user.isDemo === undefined ? false : boolean(user.isDemo),
  };
}

function decodeBoard(value: unknown): Board {
  const board = object(value);
  return {
    id: string(board.id),
    role: boardRole(board.role),
    title: string(board.title),
    updatedAt: string(board.updatedAt),
  };
}

function decodeBoardMember(value: unknown): BoardMember {
  const member = object(value);
  return {
    displayName: string(member.displayName),
    email: string(member.email),
    role: boardRole(member.role),
    userId: string(member.userId),
  };
}

function decodeInviteLink(value: unknown): BoardInviteLink {
  const link = object(value);
  return {
    expiresAt: string(link.expiresAt),
    id: string(link.id),
    role: inviteRole(link.role),
  };
}

function decodeTrashedBoard(value: unknown): TrashedCloudBoardSummary {
  const board = object(value);
  return {
    deletedAt: string(board.deletedAt),
    id: string(board.id),
    title: string(board.title),
  };
}

/** Validates a response that starts an out-of-band email-code step. */
export function decodeVerificationRequiredResponse(value: unknown): {
  email?: string;
  verificationRequired: true;
} {
  const response = object(value);
  if (response.verificationRequired !== true) {
    throw new TypeError(INVALID_RESPONSE_MESSAGE);
  }
  return {
    ...(response.email === undefined ? {} : { email: string(response.email) }),
    verificationRequired: true,
  };
}

/** Validates the session/register/login response envelope. */
export function decodeUserResponse(value: unknown): { user: User } {
  return { user: decodeUser(object(value).user) };
}

/** Validates one board response envelope. */
export function decodeBoardResponse(value: unknown): { board: Board } {
  return { board: decodeBoard(object(value).board) };
}

/** Validates a board-list response envelope and every item. */
export function decodeBoardsResponse(value: unknown): { boards: Board[] } {
  return { boards: array(object(value).boards, decodeBoard) };
}

/** Validates a cloud-trash response envelope and every item. */
export function decodeTrashedBoardsResponse(value: unknown): {
  boards: TrashedCloudBoardSummary[];
} {
  return { boards: array(object(value).boards, decodeTrashedBoard) };
}

/** Validates a board-member list response and every member. */
export function decodeMembersResponse(value: unknown): {
  members: BoardMember[];
} {
  return { members: array(object(value).members, decodeBoardMember) };
}

/** Validates one board-member response envelope. */
export function decodeMemberResponse(value: unknown): { member: BoardMember } {
  return { member: decodeBoardMember(object(value).member) };
}

/** Validates an invitation-link list response and every link. */
export function decodeInviteLinksResponse(value: unknown): {
  links: BoardInviteLink[];
} {
  return { links: array(object(value).links, decodeInviteLink) };
}

/** Validates an invitation creation response including its secret token. */
export function decodeInviteLinkResponse(value: unknown): {
  link: BoardInviteLink;
  token: string;
} {
  const response = object(value);
  return {
    link: decodeInviteLink(response.link),
    token: string(response.token),
  };
}

function errorMessage(value: unknown): string | null {
  return isJsonObject(value) && typeof value.error === 'string'
    ? value.error
    : null;
}

/**
 * Sends one bounded same-origin JSON request and normalizes transport, HTTP,
 * and malformed-response failures into `ApiError`. Successful response bodies
 * cross into application code only through an explicit decoder.
 */
export function requestApi(url: string, options?: RequestInit): Promise<void>;
export function requestApi<T>(
  url: string,
  options: RequestInit | undefined,
  decode: ApiResponseDecoder<T>,
): Promise<T>;
export async function requestApi<T>(
  url: string,
  options?: RequestInit,
  decode?: ApiResponseDecoder<T>,
): Promise<T | void> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined)
    headers.set('Content-Type', 'application/json');

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options?.signal?.reason);
  if (options?.signal?.aborted === true) abortFromCaller();
  else
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(
    () =>
      controller.abort(
        new DOMException('API request timed out', 'TimeoutError'),
      ),
    API_REQUEST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError('Chalkboard is unavailable', null, { cause: error });
  } finally {
    window.clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abortFromCaller);
  }

  const requestId = responseRequestId(response);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(
      errorMessage(body) ?? 'The server returned an error without details.',
      response.status,
      { requestId },
    );
  }
  if (response.status === 204) {
    if (decode === undefined) return;
    throw new ApiError(INVALID_RESPONSE_MESSAGE, response.status, {
      requestId,
    });
  }
  if (decode === undefined) return;

  try {
    const body: unknown = await response.json();
    return decode(body);
  } catch (error) {
    throw new ApiError(INVALID_RESPONSE_MESSAGE, response.status, {
      cause: error,
      requestId,
    });
  }
}

/** Narrows unknown failures to the normalized API error type. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Reports whether retrying later may recover from the failure. */
export function isUnavailableError(error: unknown): boolean {
  return isApiError(error) && (error.status === null || error.status >= 500);
}
