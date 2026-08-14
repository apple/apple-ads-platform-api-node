/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AUTHORIZATION_HEADER, BEARER_PREFIX } from './constants';
import type { AccessTokenProvider, Logger } from './types';

/**
 * Used to track whether a request has already been retried due to 401 response.
 * Each request has an InternalAxiosRequestConfig instance associated with it.
 */
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _authRetried?: boolean;
}

/**
 * Attaches the current cached Bearer token to every outgoing request.
 * Runs before AuthResponseInterceptor, which handles reactive token refresh on 401.
 */
export class AuthRequestInterceptor {
  constructor(private readonly accessTokenProvider: AccessTokenProvider) {}

  onFulfilled(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    config.headers[AUTHORIZATION_HEADER] =
      BEARER_PREFIX + this.accessTokenProvider.getCurrentAccessToken();
    return config;
  }
}

/**
 * Handles 401 Unauthorized responses by refreshing the token and retrying the
 * request once. A second 401 after the retry is surfaced to the caller unchanged.
 */
export class AuthResponseInterceptor {
  constructor(
    private readonly axiosInstance: AxiosInstance,
    private readonly accessTokenProvider: AccessTokenProvider,
    private readonly logger?: Logger | null,
  ) {}

  async onRejected(error: unknown): Promise<AxiosResponse> {
    const axiosError = error as { response?: { status: number }; config?: RetryableRequestConfig };
    const config = axiosError.config;

    if (axiosError.response?.status !== 401 || !config || config._authRetried) {
      throw error;
    }

    config._authRetried = true;

    const authHeader = config.headers[AUTHORIZATION_HEADER] as string | undefined;
    const staleToken = authHeader?.startsWith(BEARER_PREFIX)
      ? authHeader.slice(BEARER_PREFIX.length)
      : null;

    const freshToken = await this.accessTokenProvider.getOrRefreshIfStale(staleToken);
    config.headers[AUTHORIZATION_HEADER] = BEARER_PREFIX + freshToken;

    const method = config.method?.toUpperCase() ?? 'UNKNOWN';
    const url = config.url ?? 'unknown';
    this.logger?.info(`retrying ${method} ${url} after 401 - token refreshed`);

    return this.axiosInstance(config);
  }
}

/**
 * Installs both auth interceptors on the provided axios instance.
 */
export function installAuthInterceptors(
  axiosInstance: AxiosInstance,
  accessTokenProvider: AccessTokenProvider,
  logger?: Logger | null,
): void {
  const requestInterceptor = new AuthRequestInterceptor(accessTokenProvider);
  axiosInstance.interceptors.request.use(
    requestInterceptor.onFulfilled.bind(requestInterceptor),
  );

  const responseInterceptor = new AuthResponseInterceptor(axiosInstance, accessTokenProvider, logger);
  axiosInstance.interceptors.response.use(
    undefined,
    responseInterceptor.onRejected.bind(responseInterceptor),
  );
}