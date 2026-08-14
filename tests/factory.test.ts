/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import * as agentkeepalive from 'agentkeepalive';
import { createAppleAdsApi, DEFAULT_TIMEOUT_MS, DEFAULT_BASE_URL } from '../src/factory';

jest.mock('agentkeepalive', () => ({
  HttpAgent: jest.fn().mockImplementation(() => ({})),
  HttpsAgent: jest.fn().mockImplementation(() => ({})),
}));
import { AxiosHeaders, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { AppleAdsApi } from '../src/api';
import { EphemeralClientSecretProvider } from '../src/auth/ephemeral-client-secret-provider';
import { AccessTokenFetcher } from '../src/auth/access-token-fetcher';
import { InMemoryCachingAccessTokenProvider } from '../src/auth/in-memory-caching-access-token-provider';
import * as interceptors from '../src/auth/interceptors';
import * as logging from '../src/logging';
import type { AccessTokenProvider, ClientSecretProvider } from '../src/auth/types';
import { AUTH_AUDIENCE } from '../src/auth/constants';
import { DEFAULT_REQUEST_LOG_LEVEL, DEFAULT_ERROR_LOG_LEVEL } from '../src/logging';
import { version as packageVersion } from '../package.json';

jest.mock('../src/auth/ephemeral-client-secret-provider');
jest.mock('../src/auth/access-token-fetcher');
jest.mock('../src/auth/in-memory-caching-access-token-provider');
jest.mock('../src/auth/interceptors');
jest.mock('../src/logging', () => ({
  ...jest.requireActual('../src/logging'),
  installLoggingInterceptors: jest.fn(),
}));

const FAKE_BASE_URL = 'https://fake.baseurl.com/';
const DEFAULT_AUTH_BASE_URL = AUTH_AUDIENCE + '/';

function makeMockAccessTokenProvider(): jest.Mocked<AccessTokenProvider> {
  return {
    getCurrentAccessToken: jest.fn().mockReturnValue('mock-token'),
    getAndPersistNewAccessToken: jest.fn().mockResolvedValue('mock-token'),
    getOrRefreshIfStale: jest.fn().mockResolvedValue('mock-token'),
  };
}

function makeMockClientSecretProvider(): jest.Mocked<ClientSecretProvider> {
  return { getClientSecret: jest.fn().mockReturnValue('mock-secret') };
}

beforeEach(() => {
  jest.clearAllMocks();
  (InMemoryCachingAccessTokenProvider.create as jest.Mock).mockResolvedValue(
    makeMockAccessTokenProvider(),
  );
  (EphemeralClientSecretProvider.create as jest.Mock).mockResolvedValue({
    getClientSecret: jest.fn().mockReturnValue('mock-secret'),
  });
});

describe('createAppleAdsApi', () => {
  describe('authMode: token', () => {
    it('returns an AppleAdsApi instance', async () => {
      const api = await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect(api).toBeInstanceOf(AppleAdsApi);
    });

    it('uses the provided accessTokenProvider directly without fetching a token', async () => {
      const provider = makeMockAccessTokenProvider();
      await createAppleAdsApi({ authMode: 'token', baseUrl: FAKE_BASE_URL, accessTokenProvider: provider });
      expect(InMemoryCachingAccessTokenProvider.create).not.toHaveBeenCalled();
      expect(AccessTokenFetcher).not.toHaveBeenCalled();
    });

    it('installs auth interceptors with the provided provider', async () => {
      const provider = makeMockAccessTokenProvider();
      await createAppleAdsApi({ authMode: 'token', baseUrl: FAKE_BASE_URL, accessTokenProvider: provider });
      expect(interceptors.installAuthInterceptors).toHaveBeenCalledWith(
        expect.anything(),
        provider,
        expect.anything(), // logger
      );
    });

    it('calls apiAxiosCustomizer with the api axios instance', async () => {
      const customizer = jest.fn();
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: customizer,
      });
      expect(customizer).toHaveBeenCalledTimes(1);
      expect(customizer).toHaveBeenCalledWith(expect.objectContaining({ defaults: expect.anything() }));
    });

    it('passes the api axios instance to both the customizer and installAuthInterceptors', async () => {
      let capturedCustomizerInstance: unknown;
      const customizer = jest.fn((instance) => { capturedCustomizerInstance = instance; });
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: customizer,
      });
      const [interceptorAxiosArg] = (interceptors.installAuthInterceptors as jest.Mock).mock.calls[0];
      expect(interceptorAxiosArg).toBe(capturedCustomizerInstance);
    });
  });

  describe('authMode: key', () => {
    const keyOptions = {
      authMode: 'key' as const,
      baseUrl: FAKE_BASE_URL,
      clientId: 'client-id',
      teamId: 'team-id',
      keyId: 'key-id',
      privateKeyPath: '/path/to/key.pem',
    };

    it('returns an AppleAdsApi instance', async () => {
      const api = await createAppleAdsApi(keyOptions);
      expect(api).toBeInstanceOf(AppleAdsApi);
    });

    it('constructs EphemeralClientSecretProvider with correct arguments', async () => {
      await createAppleAdsApi(keyOptions);
      expect(EphemeralClientSecretProvider.create).toHaveBeenCalledWith(
        keyOptions.privateKeyPath,
        keyOptions.clientId,
        keyOptions.teamId,
        keyOptions.keyId,
      );
    });

    it('constructs AccessTokenFetcher with default auth base URL', async () => {
      await createAppleAdsApi(keyOptions);
      const [authBaseUrl] = (AccessTokenFetcher as jest.Mock).mock.calls[0];
      expect(authBaseUrl).toBe(DEFAULT_AUTH_BASE_URL);
    });

    it('constructs AccessTokenFetcher with custom authBaseUrl when provided', async () => {
      await createAppleAdsApi({ ...keyOptions, authBaseUrl: 'https://custom.auth.example.com/' });
      const [authBaseUrl] = (AccessTokenFetcher as jest.Mock).mock.calls[0];
      expect(authBaseUrl).toBe('https://custom.auth.example.com/');
    });

    it('creates InMemoryCachingAccessTokenProvider via static factory', async () => {
      await createAppleAdsApi(keyOptions);
      expect(InMemoryCachingAccessTokenProvider.create).toHaveBeenCalledTimes(1);
      expect(InMemoryCachingAccessTokenProvider.create).toHaveBeenCalledWith(
        expect.any(AccessTokenFetcher),
        expect.anything(), // logger
      );
    });

    it('calls authAxiosCustomizer with the auth axios instance', async () => {
      const authCustomizer = jest.fn();
      await createAppleAdsApi({ ...keyOptions, authAxiosCustomizer: authCustomizer });
      expect(authCustomizer).toHaveBeenCalledTimes(1);
    });

    it('passes separate axios instances to api and auth customizers', async () => {
      let apiInstance: unknown;
      let authInstance: unknown;
      const apiCustomizer = jest.fn((i) => { apiInstance = i; });
      const authCustomizer = jest.fn((i) => { authInstance = i; });
      await createAppleAdsApi({ ...keyOptions, apiAxiosCustomizer: apiCustomizer, authAxiosCustomizer: authCustomizer });
      expect(apiInstance).not.toBe(authInstance);
    });

    it('passes the auth axios instance to AccessTokenFetcher', async () => {
      let capturedAuthInstance: unknown;
      const authCustomizer = jest.fn((i) => { capturedAuthInstance = i; });
      await createAppleAdsApi({ ...keyOptions, authAxiosCustomizer: authCustomizer });
      const fetcherArgs = (AccessTokenFetcher as jest.Mock).mock.calls[0];
      expect(fetcherArgs[3]).toBe(capturedAuthInstance);
    });

    it('installs auth interceptors on the api axios instance', async () => {
      let capturedApiInstance: unknown;
      const apiCustomizer = jest.fn((i) => { capturedApiInstance = i; });
      await createAppleAdsApi({ ...keyOptions, apiAxiosCustomizer: apiCustomizer });
      const [interceptorAxiosArg] = (interceptors.installAuthInterceptors as jest.Mock).mock.calls[0];
      expect(interceptorAxiosArg).toBe(capturedApiInstance);
    });
  });

  describe('authMode: clientSecret', () => {
    it('uses the provided clientSecretProvider without constructing EphemeralClientSecretProvider', async () => {
      const secretProvider = makeMockClientSecretProvider();
      await createAppleAdsApi({
        authMode: 'clientSecret',
        baseUrl: FAKE_BASE_URL,
        clientId: 'client-id',
        clientSecretProvider: secretProvider,
      });
      expect(EphemeralClientSecretProvider.create).not.toHaveBeenCalled();
      const fetcherArgs = (AccessTokenFetcher as jest.Mock).mock.calls[0];
      expect(fetcherArgs[2]).toBe(secretProvider);
    });
  });

  describe('connection pooling', () => {
    it('creates API axios instance with keepAlive HttpAgent', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect(agentkeepalive.HttpAgent).toHaveBeenCalledWith(
        expect.objectContaining({ keepAlive: true }),
      );
    });

    it('creates API axios instance with keepAlive HttpsAgent', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect(agentkeepalive.HttpsAgent).toHaveBeenCalledWith(
        expect.objectContaining({ keepAlive: true }),
      );
    });

    it('applies apiTimeout to the api axios instance', async () => {
      let capturedInstance: { defaults: { timeout?: number } } | undefined;
      const apiCustomizer = jest.fn((i) => { capturedInstance = i; });
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        apiTimeout: 7000,
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: apiCustomizer,
      });
      expect(capturedInstance?.defaults.timeout).toBe(7000);
    });

    it('applies the default 5000ms timeout when apiTimeout is omitted', async () => {
      let capturedInstance: { defaults: { timeout?: number } } | undefined;
      const apiCustomizer = jest.fn((i) => { capturedInstance = i; });
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: apiCustomizer,
      });
      expect(capturedInstance?.defaults.timeout).toBe(DEFAULT_TIMEOUT_MS);
    });

    it('applies authTimeout to the auth axios instance', async () => {
      let capturedAuthInstance: { defaults: { timeout?: number } } | undefined;
      const authCustomizer = jest.fn((i) => { capturedAuthInstance = i; });
      await createAppleAdsApi({
        authMode: 'key',
        baseUrl: FAKE_BASE_URL,
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
        authTimeout: 3000,
        authAxiosCustomizer: authCustomizer,
      });
      expect(capturedAuthInstance?.defaults.timeout).toBe(3000);
    });

    it('passes maxSockets, maxFreeSockets, and freeSocketTimeout to agents', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        baseUrl: FAKE_BASE_URL,
        maxSockets: 25,
        maxFreeSockets: 5,
        freeSocketTimeout: 10_000,
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      const expected = expect.objectContaining({ maxSockets: 25, maxFreeSockets: 5, freeSocketTimeout: 10_000 });
      expect(agentkeepalive.HttpAgent).toHaveBeenCalledWith(expected);
      expect(agentkeepalive.HttpsAgent).toHaveBeenCalledWith(expected);
    });

    it('does not enable connection pooling for the auth axios instance', async () => {
      await createAppleAdsApi({
        authMode: 'key',
        baseUrl: FAKE_BASE_URL,
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
      });
      // Only the API instance uses agentkeepalive; the auth instance does not
      expect(agentkeepalive.HttpAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('baseUrl', () => {
    it('passes baseUrl to AppleAdsApi when provided', async () => {
      const customUrl = 'https://custom.api.example.com/v1';
      const api = await createAppleAdsApi({
        authMode: 'token',
        baseUrl: customUrl,
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect((api as unknown as { basePath: string }).basePath).toBe(customUrl);
    });

    it('uses the default base URL when baseUrl is omitted', async () => {
      const api = await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect((api as unknown as { basePath: string }).basePath).toBe(DEFAULT_BASE_URL);
    });
  });

  describe('logging', () => {
    it('installs logging on the API instance by default (using console)', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect(logging.installLoggingInterceptors).toHaveBeenCalledWith(
        expect.anything(),
        console,
        DEFAULT_REQUEST_LOG_LEVEL,
        DEFAULT_ERROR_LOG_LEVEL,
      );
    });

    it('installs logging on both API and auth instances for key authMode', async () => {
      await createAppleAdsApi({
        authMode: 'key',
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
      });
      expect(logging.installLoggingInterceptors).toHaveBeenCalledTimes(2);
    });

    it('installs logging only on the API instance for token authMode', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      expect(logging.installLoggingInterceptors).toHaveBeenCalledTimes(1);
    });

    it('uses the provided custom logger', async () => {
      const customLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
        logger: customLogger,
      });
      expect(logging.installLoggingInterceptors).toHaveBeenCalledWith(
        expect.anything(),
        customLogger,
        expect.anything(),
        expect.anything(),
      );
    });

    it('uses the provided requestLogLevel and errorLogLevel', async () => {
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
        requestLogLevel: 'debug',
        errorLogLevel: 'warn',
      });
      expect(logging.installLoggingInterceptors).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'debug',
        'warn',
      );
    });

    it('does not install logging when logger is null', async () => {
      await createAppleAdsApi({
        authMode: 'key',
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
        logger: null,
      });
      expect(logging.installLoggingInterceptors).not.toHaveBeenCalled();
    });

    it('does not install logging when logger is undefined', async () => {
      await createAppleAdsApi({
        authMode: 'key',
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
        logger: undefined,
      });
      expect(logging.installLoggingInterceptors).not.toHaveBeenCalled();
    });
  });

  describe('user-agent interceptor', () => {
    async function applyRequestInterceptors(
      instance: AxiosInstance,
      config: InternalAxiosRequestConfig,
    ): Promise<InternalAxiosRequestConfig> {
      const handlers = (instance.interceptors.request as unknown as {
        handlers: Array<{ fulfilled?: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig> } | null>;
      }).handlers;
      let result = config;
      for (const h of handlers) {
        if (h?.fulfilled) result = await h.fulfilled(result);
      }
      return result;
    }

    function makeFakeRequestConfig(): InternalAxiosRequestConfig {
      return { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    }

    it('sets the User-Agent header to apple-ads-node-<version> for authMode: token', async () => {
      let apiInstance: AxiosInstance | undefined;
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: (i) => { apiInstance = i; },
      });
      const result = await applyRequestInterceptors(apiInstance!, makeFakeRequestConfig());
      expect(result.headers.get('User-Agent')).toBe(`apple-ads-node-${packageVersion}`);
    });

    it('sets the User-Agent header to apple-ads-node-<version> for authMode: key', async () => {
      let apiInstance: AxiosInstance | undefined;
      await createAppleAdsApi({
        authMode: 'key',
        clientId: 'c',
        teamId: 't',
        keyId: 'k',
        privateKeyPath: '/key.pem',
        apiAxiosCustomizer: (i) => { apiInstance = i; },
      });
      const result = await applyRequestInterceptors(apiInstance!, makeFakeRequestConfig());
      expect(result.headers.get('User-Agent')).toBe(`apple-ads-node-${packageVersion}`);
    });

    it('sets the User-Agent header to apple-ads-node-<version> for authMode: clientSecret', async () => {
      let apiInstance: AxiosInstance | undefined;
      await createAppleAdsApi({
        authMode: 'clientSecret',
        clientId: 'c',
        clientSecretProvider: makeMockClientSecretProvider(),
        apiAxiosCustomizer: (i) => { apiInstance = i; },
      });
      const result = await applyRequestInterceptors(apiInstance!, makeFakeRequestConfig());
      expect(result.headers.get('User-Agent')).toBe(`apple-ads-node-${packageVersion}`);
    });

    it('is installed even when no apiAxiosCustomizer is provided', async () => {
      const api = await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
      });
      const apiInstance = (api as unknown as { axios: AxiosInstance }).axios;
      const result = await applyRequestInterceptors(apiInstance, makeFakeRequestConfig());
      expect(result.headers.get('User-Agent')).toBe(`apple-ads-node-${packageVersion}`);
    });

    it('runs after the apiAxiosCustomizer', async () => {
      let interceptorCountAtCustomizerTime = -1;
      const customizer = jest.fn((instance: AxiosInstance) => {
        interceptorCountAtCustomizerTime = (instance.interceptors.request as unknown as {
          handlers: unknown[];
        }).handlers.length;
      });
      await createAppleAdsApi({
        authMode: 'token',
        accessTokenProvider: makeMockAccessTokenProvider(),
        apiAxiosCustomizer: customizer,
      });
      expect(interceptorCountAtCustomizerTime).toBe(0);
    });
  });
});