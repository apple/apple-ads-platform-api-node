/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import axios, { AxiosInstance } from 'axios';
import { HttpAgent, HttpsAgent } from 'agentkeepalive';
import { AppleAdsApi } from './api';
import { EphemeralClientSecretProvider } from './auth/ephemeral-client-secret-provider';
import { AccessTokenFetcher } from './auth/access-token-fetcher';
import { InMemoryCachingAccessTokenProvider } from './auth/in-memory-caching-access-token-provider';
import { installAuthInterceptors } from './auth/interceptors';
import { AUTH_AUDIENCE } from './auth/constants';
import type { AccessTokenProvider, ClientSecretProvider } from './auth/types';
import { installErrorInterceptor } from './error-interceptor';
import {
  installLoggingInterceptors,
  DEFAULT_REQUEST_LOG_LEVEL,
  DEFAULT_ERROR_LOG_LEVEL,
} from './logging';
import type { Logger, LogLevel } from './logging';
import { version } from '../package.json';

const USER_AGENT = `apple-ads-node-${version}`;

const DEFAULT_AUTH_BASE_URL = AUTH_AUDIENCE + '/';
export const DEFAULT_BASE_URL = 'https://api.ads.apple.com/v1/';

/**
 * Default connection pool settings for the API axios instance.
 * These do not apply to the auth axios instance, which uses a plain connection
 * (no keep-alive) since token refreshes are too infrequent to benefit from pooling.
 */
const DEFAULT_MAX_SOCKETS = 50;
const DEFAULT_MAX_FREE_SOCKETS = 10;
export const DEFAULT_TIMEOUT_MS = 5_000;
/**
 * Idle sockets are removed from the pool after this many milliseconds of inactivity.
 * Prevents stale connection errors when the API server closes an idle keep-alive
 * connection before the client attempts to reuse it.
 */
const DEFAULT_FREE_SOCKET_TIMEOUT_MS = 30_000;

interface CommonOptions {
  /** Base URL for the Apple Ads API. Defaults to https://api.ads.apple.com/v1/. */
  baseUrl?: string;
  /** Timeout in milliseconds for API requests. Defaults to 5000ms. */
  apiTimeout?: number;
  /**
   * Maximum number of open sockets per host for the API connection pool. Defaults to 50.
   * Has no effect on the auth axios instance, which does not use connection pooling.
   */
  maxSockets?: number;
  /**
   * Maximum number of idle keep-alive sockets per host for the API connection pool. Defaults to 10.
   * Has no effect on the auth axios instance, which does not use connection pooling.
   */
  maxFreeSockets?: number;
  /**
   * Idle sockets are evicted from the API connection pool after this many milliseconds.
   * Defaults to 30000ms. Set this below the server's keep-alive idle timeout to avoid
   * stale connection errors.
   * Has no effect on the auth axios instance, which does not use connection pooling.
   */
  freeSocketTimeout?: number;
  /**
   * Optional callback to customize the axios instance used for API calls.
   * The factory creates the instance with keep-alive connection pooling enabled; this
   * callback lets you add interceptors, headers, or override any settings.
   */
  apiAxiosCustomizer?: (instance: AxiosInstance) => void;
  /**
   * Logger for HTTP request/response logging. Defaults to `console`.
   * Pass `null` to disable logging entirely.
   */
  logger?: Logger | null;
  /**
   * Log level for request start and successful responses. Defaults to 'info'.
   * Applies to both API and auth axios instances.
   */
  requestLogLevel?: LogLevel;
  /**
   * Log level for request errors. Defaults to 'error'.
   * Applies to both API and auth axios instances.
   */
  errorLogLevel?: LogLevel;
}

/** Full key-based auth: the factory constructs the JWT client secret internally. */
export interface KeyAuthOptions extends CommonOptions {
  authMode: 'key';
  clientId: string;
  teamId: string;
  keyId: string;
  /** Path to the .pem private key file created for authentication with the Apple Ads Platform API. */
  privateKeyPath: string;
  /** Override the Apple auth base URL (default: https://appleid.apple.com/). */
  authBaseUrl?: string;
  /** Timeout in milliseconds for token requests to the auth server. Defaults to 5000ms. */
  authTimeout?: number;
  /** Optional callback to customize the axios instance used for token requests. */
  authAxiosCustomizer?: (instance: AxiosInstance) => void;
}

/** Bring-your-own client secret: you supply a {@link ClientSecretProvider} implementation. */
export interface ClientSecretAuthOptions extends CommonOptions {
  authMode: 'clientSecret';
  clientId: string;
  clientSecretProvider: ClientSecretProvider;
  /** Override the Apple auth base URL (default: https://appleid.apple.com/). */
  authBaseUrl?: string;
  /** Timeout in milliseconds for token requests to the auth server. Defaults to 5000ms. */
  authTimeout?: number;
  /** Optional callback to customize the axios instance used for token requests. */
  authAxiosCustomizer?: (instance: AxiosInstance) => void;
}

/** Bring-your-own token: you supply a fully configured {@link AccessTokenProvider}. */
export interface TokenAuthOptions extends CommonOptions {
  authMode: 'token';
  accessTokenProvider: AccessTokenProvider;
}

export type AppleAdsApiOptions = KeyAuthOptions | ClientSecretAuthOptions | TokenAuthOptions;

/**
 * Creates an axios instance with keep-alive connection pooling for high-frequency API calls.
 * Uses agentkeepalive to evict idle sockets before they go stale.
 */
function createPooledApiAxiosInstance(
  timeout?: number,
  maxSockets?: number,
  maxFreeSockets?: number,
  freeSocketTimeout?: number,
): AxiosInstance {
  const agentOptions = {
    keepAlive: true,
    maxSockets: maxSockets ?? DEFAULT_MAX_SOCKETS,
    maxFreeSockets: maxFreeSockets ?? DEFAULT_MAX_FREE_SOCKETS,
    freeSocketTimeout: freeSocketTimeout ?? DEFAULT_FREE_SOCKET_TIMEOUT_MS,
  };
  return axios.create({
    timeout,
    httpAgent: new HttpAgent(agentOptions),
    httpsAgent: new HttpsAgent(agentOptions),
  });
}

/**
 * Creates a plain axios instance without connection pooling for auth token requests.
 * Keep-alive is intentionally disabled: token refreshes are too infrequent (typically
 * once per hour) to benefit from pooling, and reusing a stale connection would cause
 * ECONNRESET errors.
 */
function createAuthAxiosInstance(timeout?: number): AxiosInstance {
  return axios.create({ timeout });
}

function installUserAgentInterceptor(instance: AxiosInstance): void {
  instance.interceptors.request.use((config) => {
    config.headers.set('User-Agent', USER_AGENT);
    return config;
  });
}

/**
 * Creates a fully configured {@link AppleAdsApi} instance.
 *
 * - For `authMode: 'key'` and `authMode: 'clientSecret'`, this function is async
 *   because it fetches an initial access token before returning.
 * - For `authMode: 'token'`, the provided {@link AccessTokenProvider} is used directly.
 *
 * The API axios instance is created with keep-alive connection pooling via agentkeepalive.
 * The auth axios instance uses a plain connection (no pooling). Use the
 * `apiAxiosCustomizer` / `authAxiosCustomizer` callbacks to add interceptors or override defaults.
 *
 * Logging is installed before the initial token fetch on the auth instance, so all token
 * requests (including the first) are captured. On the API instance, logging is installed
 * last (after auth interceptors) so that response logs reflect final outcomes rather than
 * intermediate states such as 401 responses that are transparently retried.
 */
export async function createAppleAdsApi(options: AppleAdsApiOptions): Promise<AppleAdsApi> {
  const logger: Logger | null = 'logger' in options
    ? (options.logger ?? null)
    : console;
  const requestLogLevel: LogLevel = options.requestLogLevel ?? DEFAULT_REQUEST_LOG_LEVEL;
  const errorLogLevel: LogLevel = options.errorLogLevel ?? DEFAULT_ERROR_LOG_LEVEL;

  const apiAxiosInstance = createPooledApiAxiosInstance(
    options.apiTimeout ?? DEFAULT_TIMEOUT_MS,
    options.maxSockets,
    options.maxFreeSockets,
    options.freeSocketTimeout,
  );
  options.apiAxiosCustomizer?.(apiAxiosInstance);
  installUserAgentInterceptor(apiAxiosInstance);

  let accessTokenProvider: AccessTokenProvider;

  if (options.authMode === 'token') {
    accessTokenProvider = options.accessTokenProvider;
  } else {
    const authAxiosInstance = createAuthAxiosInstance(options.authTimeout ?? DEFAULT_TIMEOUT_MS);
    options.authAxiosCustomizer?.(authAxiosInstance);

    if (logger) {
      installLoggingInterceptors(authAxiosInstance, logger, requestLogLevel, errorLogLevel);
    }

    const clientSecretProvider: ClientSecretProvider =
      options.authMode === 'key'
        ? await EphemeralClientSecretProvider.create(
            options.privateKeyPath,
            options.clientId,
            options.teamId,
            options.keyId,
          )
        : options.clientSecretProvider;

    const fetcher = new AccessTokenFetcher(
      options.authBaseUrl ?? DEFAULT_AUTH_BASE_URL,
      options.clientId,
      clientSecretProvider,
      authAxiosInstance,
    );

    accessTokenProvider = await InMemoryCachingAccessTokenProvider.create(fetcher, logger);
  }

  installAuthInterceptors(apiAxiosInstance, accessTokenProvider, logger);

  if (logger) {
    installLoggingInterceptors(apiAxiosInstance, logger, requestLogLevel, errorLogLevel);
  }

  // Installed last so it runs outermost on the response-error path: the auth retry and
  // logging interceptors above must see the raw axios error first. This converts the
  // rejection that escapes the library into a flat, serializable ApiRequestError,
  // stripping the circular references axios attaches via the ClientRequest/socket and
  // the keep-alive agent.
  installErrorInterceptor(apiAxiosInstance);

  return new AppleAdsApi(options.baseUrl ?? DEFAULT_BASE_URL, apiAxiosInstance);
}