/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import { AccessTokenFetchError } from './errors';
import type { AccessTokenFetcher } from './access-token-fetcher';
import type { AccessTokenProvider, FetchedToken, Logger } from './types';

export const EXPIRY_BUFFER_SECONDS = 60;
export const MIN_REFRESH_DELAY_SECONDS = 30;

export class InMemoryCachingAccessTokenProvider implements AccessTokenProvider {
  private cachedToken!: string;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<string> | null = null;
  private closed = false;

  private constructor(
    private readonly fetcher: AccessTokenFetcher,
    private readonly logger?: Logger | null,
  ) {}

  static async create(
    fetcher: AccessTokenFetcher,
    logger?: Logger | null,
  ): Promise<InMemoryCachingAccessTokenProvider> {
    const provider = new InMemoryCachingAccessTokenProvider(fetcher, logger);
    await provider.getAndPersistNewAccessToken();
    return provider;
  }

  getCurrentAccessToken(): string {
    return this.cachedToken;
  }

  async getAndPersistNewAccessToken(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doFetch().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async getOrRefreshIfStale(staleToken: string | null): Promise<string> {
    if (staleToken !== null && staleToken !== this.cachedToken) {
      return this.cachedToken;
    }
    return this.getAndPersistNewAccessToken();
  }

  private async doFetch(): Promise<string> {
    let fetched: FetchedToken;
    try {
      fetched = await this.fetcher.getAccessToken();
    } catch (err) {
      throw err instanceof AccessTokenFetchError
        ? err
        : new AccessTokenFetchError('Unexpected error fetching access token', err as Error);
    }

    this.cachedToken = fetched.token;
    this.scheduleRefresh(fetched.expiresInSeconds);
    return fetched.token;
  }

  private scheduleRefresh(expiresInSeconds: number): void {
    if (this.closed) return;

    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }

    const delaySeconds = Math.max(
      MIN_REFRESH_DELAY_SECONDS,
      expiresInSeconds - EXPIRY_BUFFER_SECONDS,
    );

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.getAndPersistNewAccessToken().catch((err) => {
        if (this.logger) {
          this.logger.warn(
            'Proactive token refresh failed; relying on reactive 401 handling as fallback',
            err,
          );
        }
      });
    }, delaySeconds * 1000);

    this.refreshTimer.unref();
  }

  close(): void {
    this.closed = true;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}