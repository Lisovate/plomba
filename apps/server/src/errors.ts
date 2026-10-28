/**
 * Errors the HTTP layer knows how to report. Services throw these; the error
 * handler turns them into RFC 9457 problem details. Anything else is a 500.
 */

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;
  readonly issues: readonly Issue[] | undefined;

  constructor(message: string, options?: { cause?: unknown; issues?: readonly Issue[] }) {
    super(message, options);
    this.issues = options?.issues;
  }
}

export class ValidationError extends AppError {
  override name = 'ValidationError';
  readonly status = 400;
  readonly type = 'validation';
}

export class UnauthorizedError extends AppError {
  override name = 'UnauthorizedError';
  readonly status = 401;
  readonly type = 'unauthorized';
}

export class NotFoundError extends AppError {
  override name = 'NotFoundError';
  readonly status = 404;
  readonly type = 'not-found';
}

export class ConflictError extends AppError {
  override name = 'ConflictError';
  readonly status = 409;
  readonly type = 'conflict';
}

/** A model call failed or returned something unusable. */
export class UpstreamError extends AppError {
  override name = 'UpstreamError';
  readonly status = 502;
  readonly type = 'upstream';
}
