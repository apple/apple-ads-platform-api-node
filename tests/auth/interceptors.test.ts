/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
  AuthRequestInterceptor,
  AuthResponseInterceptor,
  installAuthInterceptors,
} from '../../src/auth/interceptors';
import { AUTHORIZATION_HEADER, BEARER_PREFIX } from '../../src/auth/constants';
import type { AccessTokenProvider, Logger } from '../../src/auth/types';

const TOKEN = 'initial-token';
const REFRESHED_TOKEN = 'refreshed-token';

function makeProvider(overrides?: Partial<AccessTokenProvider>): AccessTokenProvider {
  return {
    getCurrentAccessToken: jest.fn().mockReturnValue(TOKEN),
    getAndPersistNewAccessToken: jest.fn().mockResolvedValue(REFRESHED_TOKEN),
    getOrRefreshIfStale: jest.fn().mockResolvedValue(REFRESHED_TOKEN),
    ...overrides,
  };
}

function makeMockLogger(): jest.Mocked<Logger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('AuthRequestInterceptor', () => {
  it('attaches Authorization header with current token', () => {
    const provider = makeProvider();
    const interceptor = new AuthRequestInterceptor(provider);
    const config = { headers: { [AUTHORIZATION_HEADER]: '' } } as unknown as Parameters<typeof interceptor.onFulfilled>[0];

    const result = interceptor.onFulfilled(config);

    expect(result.headers[AUTHORIZATION_HEADER]).toBe(`${BEARER_PREFIX}${TOKEN}`);
    expect(provider.getCurrentAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('AuthResponseInterceptor', () => {
  let axiosInstance: ReturnType<typeof axios.create>;
  let mock: MockAdapter;
  let provider: AccessTokenProvider;
  let interceptor: AuthResponseInterceptor;

  beforeEach(() => {
    axiosInstance = axios.create();
    mock = new MockAdapter(axiosInstance);
    provider = makeProvider();
    interceptor = new AuthResponseInterceptor(axiosInstance, provider);
  });

  afterEach(() => mock.restore());

  it('rethrows non-401 errors unchanged', async () => {
    const error = { response: { status: 500 }, config: { headers: {} } };
    await expect(interceptor.onRejected(error)).rejects.toBe(error);
  });

  it('rethrows 401 if already retried', async () => {
    const error = {
      response: { status: 401 },
      config: { headers: {}, _authRetried: true },
    };
    await expect(interceptor.onRejected(error)).rejects.toBe(error);
  });

  it('rethrows if config is missing', async () => {
    const error = { response: { status: 401 } };
    await expect(interceptor.onRejected(error)).rejects.toBe(error);
  });

  it('refreshes token and retries on 401', async () => {
    mock.onGet('/api/resource').replyOnce(200, { ok: true });
    const error = {
      response: { status: 401 },
      config: {
        method: 'get',
        url: '/api/resource',
        headers: { [AUTHORIZATION_HEADER]: `${BEARER_PREFIX}${TOKEN}` },
      },
    };

    const response = await interceptor.onRejected(error);

    expect(provider.getOrRefreshIfStale).toHaveBeenCalledWith(TOKEN);
    expect(response.data).toEqual({ ok: true });
  });

  it('logs an info message when retrying after 401', async () => {
    mock.onGet('/api/resource').replyOnce(200, {});
    const mockLogger = makeMockLogger();
    const loggingInterceptor = new AuthResponseInterceptor(axiosInstance, provider, mockLogger);
    const error = {
      response: { status: 401 },
      config: {
        method: 'get',
        url: '/api/resource',
        headers: { [AUTHORIZATION_HEADER]: `${BEARER_PREFIX}${TOKEN}` },
      },
    };

    await loggingInterceptor.onRejected(error);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/retrying.*GET.*\/api\/resource.*401/i));
  });

  it('does not log when no logger is provided', async () => {
    mock.onGet('/api/resource').replyOnce(200, {});
    const error = {
      response: { status: 401 },
      config: {
        method: 'get',
        url: '/api/resource',
        headers: { [AUTHORIZATION_HEADER]: `${BEARER_PREFIX}${TOKEN}` },
      },
    };
    // interceptor has no logger — should not throw
    await expect(interceptor.onRejected(error)).resolves.toBeDefined();
  });

  it('passes the stale token to getOrRefreshIfStale', async () => {
    mock.onGet('/api/resource').replyOnce(200, {});
    const staleToken = 'stale-bearer-token';
    const error = {
      response: { status: 401 },
      config: {
        method: 'get',
        url: '/api/resource',
        headers: { [AUTHORIZATION_HEADER]: `${BEARER_PREFIX}${staleToken}` },
      },
    };

    await interceptor.onRejected(error);

    expect(provider.getOrRefreshIfStale).toHaveBeenCalledWith(staleToken);
  });

  it('passes null as staleToken when Authorization header is absent', async () => {
    mock.onGet('/api/resource').replyOnce(200, {});
    const error = {
      response: { status: 401 },
      config: { method: 'get', url: '/api/resource', headers: {} },
    };

    await interceptor.onRejected(error);

    expect(provider.getOrRefreshIfStale).toHaveBeenCalledWith(null);
  });
});

describe('installAuthInterceptors (integration)', () => {
  let axiosInstance: ReturnType<typeof axios.create>;
  let mock: MockAdapter;
  let provider: AccessTokenProvider;

  beforeEach(() => {
    axiosInstance = axios.create();
    mock = new MockAdapter(axiosInstance);
    provider = makeProvider();
    installAuthInterceptors(axiosInstance, provider);
  });

  afterEach(() => mock.restore());

  it('adds Authorization header to every request', async () => {
    mock.onGet('/resource').reply(200, {});
    await axiosInstance.get('/resource');
    expect(mock.history.get[0].headers?.[AUTHORIZATION_HEADER]).toBe(`${BEARER_PREFIX}${TOKEN}`);
  });

  it('retries with a refreshed token after a 401', async () => {
    mock.onGet('/resource').replyOnce(401).onGet('/resource').replyOnce(200, { ok: true });

    const response = await axiosInstance.get('/resource');

    expect(response.data).toEqual({ ok: true });
    expect(provider.getOrRefreshIfStale).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second 401 after the first retry', async () => {
    mock.onGet('/resource').reply(401);
    await expect(axiosInstance.get('/resource')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(provider.getOrRefreshIfStale).toHaveBeenCalledTimes(1);
  });
});