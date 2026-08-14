/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

/**
 * Minimal logger interface compatible with `console`, `winston`, `pino` (with a wrapper),
 * and most other logging libraries.
 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface FetchedToken {
  token: string;
  expiresInSeconds: number;
}

export interface ClientSecretProvider {
  /** Synchronous — JWT signing is CPU-only with no I/O after construction. */
  getClientSecret(): string;
}

export interface AccessTokenProvider {
  /** Synchronous — returns the currently cached token without any I/O. */
  getCurrentAccessToken(): string;

  /** Fetches a new token from the auth server, caches it, and returns it. */
  getAndPersistNewAccessToken(): Promise<string>;

  /**
   * Returns a valid token, refreshing only when `staleToken` still matches the
   * cached token. If another concurrent caller already refreshed (i.e. the cached
   * token has changed), the current cached token is returned immediately without a
   * new network request. Pass `null` to force a refresh unconditionally.
   */
  getOrRefreshIfStale(staleToken: string | null): Promise<string>;
}