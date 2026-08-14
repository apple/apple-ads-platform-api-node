/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

/**
 * Error thrown by the Apple Ads API client when an HTTP request fails — either a
 * non-2xx response or a transport/network failure with no response.
 *
 * This is a flat, fully serializable error. It carries only scalar fields plus the
 * server's response payload — never a reference to the underlying axios error, the
 * Node `ClientRequest`, the socket, or the keep-alive connection-pool agent. Those
 * objects hold circular references (`request` <-> `socket._httpMessage`,
 * `config.httpAgent` <-> pooled sockets) that make `JSON.stringify` throw
 * "Converting circular structure to JSON", which crashes consumer tooling such as
 * Jest's worker IPC.
 */
export class ApiRequestError extends Error {
  /** Axios error code, e.g. `ERR_BAD_REQUEST`, `ECONNABORTED`, `ECONNRESET`. */
  readonly code?: string;
  /** HTTP status code, when the server returned a response. Undefined for network errors. */
  readonly status?: number;
  /** HTTP status text, when available. */
  readonly statusText?: string;
  /** The server's response body (the error payload), when a response was received. */
  readonly data?: unknown;
  /** HTTP method of the failed request, uppercased. */
  readonly method?: string;
  /** URL of the failed request. */
  readonly url?: string;

  constructor(
    message: string,
    fields: {
      code?: string;
      status?: number;
      statusText?: string;
      data?: unknown;
      method?: string;
      url?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = fields.code;
    this.status = fields.status;
    this.statusText = fields.statusText;
    this.data = fields.data;
    this.method = fields.method;
    this.url = fields.url;
  }
}

/**
 * Converts an axios-shaped rejection (or any thrown value) into a cycle-free
 * {@link ApiRequestError}. Reads only serializable scalars and the parsed response body
 * (which, having come from JSON, is itself acyclic). Idempotent: an existing
 * {@link ApiRequestError} is returned unchanged.
 */
export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;

  const axiosError = error as
    | {
        message?: string;
        code?: string;
        response?: { status?: number; statusText?: string; data?: unknown };
        config?: { method?: string; url?: string };
      }
    | null
    | undefined;

  const message =
    (typeof axiosError?.message === 'string' && axiosError.message) ||
    (error instanceof Error ? error.message : String(error));

  return new ApiRequestError(message, {
    code: axiosError?.code,
    status: axiosError?.response?.status,
    statusText: axiosError?.response?.statusText,
    data: axiosError?.response?.data,
    method: axiosError?.config?.method?.toUpperCase(),
    url: axiosError?.config?.url,
  });
}
