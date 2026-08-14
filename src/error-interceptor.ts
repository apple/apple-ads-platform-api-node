/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import type { AxiosInstance } from 'axios';
import { toApiRequestError } from './errors';

/**
 * Installs a response interceptor that converts every rejection into a cycle-free
 * {@link ApiRequestError} before it propagates to the caller.
 *
 * Must be installed LAST on the response chain. Axios runs response interceptors in
 * registration order, so the last-registered handler runs outermost on the error path.
 * That ordering is required: inner interceptors — the auth retry interceptor (which
 * inspects the raw 401 response and config to decide whether to refresh and retry) and
 * the logging interceptor (which builds its summary from the raw error) — must still see
 * the original axios error. Only once they are done does this interceptor replace the
 * value that finally escapes the library with a flat, serializable error.
 *
 * Installed unconditionally (independent of whether a logger is configured): the
 * circular axios error reaches user code on the rejection path regardless of logging.
 */
export function installErrorInterceptor(axiosInstance: AxiosInstance): void {
  axiosInstance.interceptors.response.use(undefined, (error: unknown) => {
    throw toApiRequestError(error);
  });
}
