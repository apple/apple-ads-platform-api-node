/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

export type { Logger } from './auth/types';
import type { Logger } from './auth/types';

/** Log level used by {@link LoggingInterceptor}. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const DEFAULT_REQUEST_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_ERROR_LOG_LEVEL: LogLevel = 'error';

interface TimestampedRequestConfig extends InternalAxiosRequestConfig {
  _requestStartMs?: number;
}

/** Structured metadata passed as the second argument to every log call. */
interface HttpLogMeta {
  http: {
    method: string;
    url: string;
    status?: number | string;
    elapsedMs?: number;
  };
  error?: unknown;
}

/**
 * Axios interceptor that logs HTTP request start, successful responses, and errors.
 * The Authorization header is intentionally omitted from all log output.
 */
export class LoggingInterceptor {
  /**
   * Tracks request configs that have already been logged. The auth interceptor
   * retries a 401 by calling axiosInstance(config) with the same config object,
   * re-entering the interceptor chain. The WeakSet detects the reuse and suppresses
   * the duplicate log. Weak references allow the config to be garbage-collected
   * once the request completes.
   */
  private readonly loggedRequestConfigs = new WeakSet<object>();
  /**
   * Tracks request configs whose response (success or error) has already been logged.
   * Prevents the outer interceptor chain from double-logging after the inner (retry)
   * chain has already emitted the final outcome.
   */
  private readonly loggedResponseConfigs = new WeakSet<object>();

  constructor(
    private readonly logger: Logger,
    private readonly requestLogLevel: LogLevel,
    private readonly errorLogLevel: LogLevel,
  ) {}

  onRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    if (this.loggedRequestConfigs.has(config)) {
      // Retry reusing the same config — already logged the request start.
      // Do NOT overwrite _requestStartMs so elapsed time reflects total end-to-end latency.
      return config;
    }
    this.loggedRequestConfigs.add(config);
    (config as TimestampedRequestConfig)._requestStartMs = Date.now();
    const method = config.method?.toUpperCase() ?? 'UNKNOWN';
    const url = config.url ?? 'unknown';
    this.logger[this.requestLogLevel](
      `-> ${method} ${url}`,
      { http: { method, url } } satisfies HttpLogMeta,
    );
    return config;
  }

  onResponse(response: AxiosResponse): AxiosResponse {
    const config = response.config as TimestampedRequestConfig;
    if (this.loggedResponseConfigs.has(config)) return response;
    this.loggedResponseConfigs.add(config);
    const method = response.config.method?.toUpperCase() ?? 'UNKNOWN';
    const url = response.config.url ?? 'unknown';
    const status = response.status;
    const elapsed = this.elapsedMs(config);
    this.logger[this.requestLogLevel](
      `<- ${status} ${method} ${url}` + (elapsed !== null ? ` (${elapsed}ms)` : ''),
      { http: { method, url, status, ...(elapsed !== null && { elapsedMs: elapsed }) } } satisfies HttpLogMeta,
    );
    return response;
  }

  onResponseError(error: unknown): never {
    const axiosError = error as {
      response?: { status: number; data?: unknown };
      config?: TimestampedRequestConfig;
      code?: string;
      message?: string;
    };
    const config = axiosError.config;
    if (config && this.loggedResponseConfigs.has(config)) throw error;
    if (config) this.loggedResponseConfigs.add(config);
    const status = axiosError.response?.status ?? axiosError.code ?? 'network error';
    const method = config?.method?.toUpperCase() ?? 'UNKNOWN';
    const url = config?.url ?? 'unknown';
    const elapsed = config ? this.elapsedMs(config) : null;
    // Flatten to a cycle-free summary: axios errors hold references to the underlying
    // ClientRequest, which forms a cycle (error.request === error.response.request).
    // Logging the raw error breaks any downstream consumer that JSON-serializes log
    // payloads — notably Jest's BufferedConsole, which crashes the worker IPC.
    const errorSummary = {
      code: axiosError.code,
      message: axiosError.message,
      responseStatus: axiosError.response?.status,
      responseData: axiosError.response?.data,
    };
    this.logger[this.errorLogLevel](
      `<- ${status} ${method} ${url}` + (elapsed !== null ? ` (${elapsed}ms)` : ''),
      { http: { method, url, status, ...(elapsed !== null && { elapsedMs: elapsed }) }, error: errorSummary } satisfies HttpLogMeta,
    );
    throw error;
  }

  private elapsedMs(config: TimestampedRequestConfig): number | null {
    const start = config._requestStartMs;
    return start !== undefined ? Date.now() - start : null;
  }
}

/**
 * Installs request and response logging interceptors on the provided axios instance.
 * Logging is installed last so that response logging fires after all other interceptors
 * (including auth retry logic), reflecting final outcomes rather than intermediate states.
 */
export function installLoggingInterceptors(
  axiosInstance: AxiosInstance,
  logger: Logger,
  requestLogLevel: LogLevel,
  errorLogLevel: LogLevel,
): void {
  const interceptor = new LoggingInterceptor(logger, requestLogLevel, errorLogLevel);
  axiosInstance.interceptors.request.use(interceptor.onRequest.bind(interceptor));
  axiosInstance.interceptors.response.use(
    interceptor.onResponse.bind(interceptor),
    interceptor.onResponseError.bind(interceptor),
  );
}