/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import { InMemoryCachingAccessTokenProvider, EXPIRY_BUFFER_SECONDS, MIN_REFRESH_DELAY_SECONDS } from '../../src/auth/in-memory-caching-access-token-provider';
import { AccessTokenFetchError } from '../../src/auth/errors';
import type { AccessTokenFetcher } from '../../src/auth/access-token-fetcher';

function makeFetcher(tokens: string[], expiresInSeconds = 3600): jest.Mocked<AccessTokenFetcher> {
  let callCount = 0;
  return {
    getAccessToken: jest.fn().mockImplementation(() =>
      Promise.resolve({ token: tokens[callCount++] ?? tokens[tokens.length - 1], expiresInSeconds }),
    ),
  } as unknown as jest.Mocked<AccessTokenFetcher>;
}

describe('InMemoryCachingAccessTokenProvider', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    it('fetches an initial token on construction', async () => {
      const fetcher = makeFetcher(['token-1']);
      await InMemoryCachingAccessTokenProvider.create(fetcher);
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('throws AccessTokenFetchError if the initial fetch fails', async () => {
      const fetcher = {
        getAccessToken: jest.fn().mockRejectedValue(new AccessTokenFetchError('fail')),
      } as unknown as AccessTokenFetcher;
      await expect(InMemoryCachingAccessTokenProvider.create(fetcher)).rejects.toThrow(
        AccessTokenFetchError,
      );
    });
  });

  describe('getCurrentAccessToken', () => {
    it('returns the cached token without calling the fetcher again', async () => {
      const fetcher = makeFetcher(['token-1']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const token = provider.getCurrentAccessToken();

      expect(token).toBe('token-1');
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAndPersistNewAccessToken', () => {
    it('fetches a new token and updates the cache', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const token = await provider.getAndPersistNewAccessToken();

      expect(token).toBe('token-2');
      expect(provider.getCurrentAccessToken()).toBe('token-2');
    });

    it('concurrent calls share a single in-flight promise', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const [a, b] = await Promise.all([
        provider.getAndPersistNewAccessToken(),
        provider.getAndPersistNewAccessToken(),
      ]);

      expect(a).toBe('token-2');
      expect(b).toBe('token-2');
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(2); // 1 initial + 1 shared refresh
    });
  });

  describe('getOrRefreshIfStale', () => {
    it('returns current token without refreshing when staleToken does not match', async () => {
      const fetcher = makeFetcher(['token-1']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const result = await provider.getOrRefreshIfStale('some-other-stale-token');

      expect(result).toBe('token-1');
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1); // no extra fetch
    });

    it('refreshes when staleToken matches the current cached token', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const result = await provider.getOrRefreshIfStale('token-1');

      expect(result).toBe('token-2');
    });

    it('always refreshes when staleToken is null', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const result = await provider.getOrRefreshIfStale(null);

      expect(result).toBe('token-2');
    });
  });

  describe('proactive refresh scheduling', () => {
    it('schedules refresh at (expiresIn - EXPIRY_BUFFER_SECONDS) seconds', async () => {
      const expiresInSeconds = 3600;
      const fetcher = makeFetcher(['token-1', 'token-2'], expiresInSeconds);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      const expectedDelay = (expiresInSeconds - EXPIRY_BUFFER_SECONDS) * 1000;
      jest.advanceTimersByTime(expectedDelay - 1);
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(2);

      provider.close();
    });

    it('clamps refresh delay to MIN_REFRESH_DELAY_SECONDS when expiresIn is very short', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2'], 10); // 10s expiry
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      jest.advanceTimersByTime(MIN_REFRESH_DELAY_SECONDS * 1000 - 1);
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(2);

      provider.close();
    });

    it('logs a warning via the provided logger and does not throw when proactive refresh fails', async () => {
      const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      let callCount = 0;
      const fetcher = {
        getAccessToken: jest.fn().mockImplementation(() => {
          if (callCount++ === 0) return Promise.resolve({ token: 'token-1', expiresInSeconds: 3600 });
          return Promise.reject(new AccessTokenFetchError('refresh failed'));
        }),
      } as unknown as AccessTokenFetcher;

      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher, mockLogger);
      await jest.advanceTimersByTimeAsync((3600 - EXPIRY_BUFFER_SECONDS) * 1000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Proactive token refresh failed'),
        expect.any(AccessTokenFetchError),
      );

      provider.close();
    });

    it('does not log when no logger is provided and proactive refresh fails', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      let callCount = 0;
      const fetcher = {
        getAccessToken: jest.fn().mockImplementation(() => {
          if (callCount++ === 0) return Promise.resolve({ token: 'token-1', expiresInSeconds: 3600 });
          return Promise.reject(new AccessTokenFetchError('refresh failed'));
        }),
      } as unknown as AccessTokenFetcher;

      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);
      await jest.advanceTimersByTimeAsync((3600 - EXPIRY_BUFFER_SECONDS) * 1000);

      expect(warnSpy).not.toHaveBeenCalled();

      provider.close();
      warnSpy.mockRestore();
    });
  });

  describe('close', () => {
    it('cancels a pending refresh timer', async () => {
      const fetcher = makeFetcher(['token-1', 'token-2']);
      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      provider.close();
      await jest.runAllTimersAsync();

      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(1); // no additional fetches
    });

    it('prevents an in-flight fetch from scheduling a new timer after close', async () => {
      let resolveFetch!: (value: { token: string; expiresInSeconds: number }) => void;
      const fetcher = {
        getAccessToken: jest.fn()
          .mockResolvedValueOnce({ token: 'token-1', expiresInSeconds: 3600 })
          .mockImplementationOnce(
            () => new Promise((resolve) => { resolveFetch = resolve; }),
          ),
      } as unknown as AccessTokenFetcher;

      const provider = await InMemoryCachingAccessTokenProvider.create(fetcher);

      // Start a refresh — its fetch is now in-flight (unresolved)
      const refreshPromise = provider.getAndPersistNewAccessToken();

      // Close before the in-flight fetch completes
      provider.close();

      // Now let the in-flight fetch complete
      resolveFetch({ token: 'token-2', expiresInSeconds: 3600 });
      await refreshPromise;

      // No new timer should have been scheduled
      await jest.runAllTimersAsync();
      expect(fetcher.getAccessToken).toHaveBeenCalledTimes(2); // initial + the one in-flight, no more
    });
  });
});