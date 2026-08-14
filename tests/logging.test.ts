/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  LoggingInterceptor,
  installLoggingInterceptors,
  DEFAULT_REQUEST_LOG_LEVEL,
  DEFAULT_ERROR_LOG_LEVEL,
} from '../src/logging';
import type { Logger, LogLevel } from '../src/logging';

function makeMockLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeConfig(overrides?: object): InternalAxiosRequestConfig {
  return { method: 'get', url: 'https://example.com/api', headers: {} as never, ...overrides } as InternalAxiosRequestConfig;
}

describe('LoggingInterceptor', () => {
  let mockLogger: jest.Mocked<Logger>;
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    mockLogger = makeMockLogger();
    interceptor = new LoggingInterceptor(mockLogger, 'info', 'error');
  });

  describe('onRequest', () => {
    it('logs method and URL at requestLogLevel', () => {
      interceptor.onRequest(makeConfig({ method: 'post', url: 'https://example.com/token' }));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('POST'), expect.anything());
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('https://example.com/token'), expect.anything());
    });

    it('passes structured http metadata as second argument', () => {
      interceptor.onRequest(makeConfig({ method: 'get', url: 'https://example.com/api' }));
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ http: expect.objectContaining({ method: 'GET', url: 'https://example.com/api' }) }),
      );
    });

    it('stores start timestamp on config', () => {
      const config = makeConfig();
      const before = Date.now();
      interceptor.onRequest(config);
      expect((config as { _requestStartMs?: number })._requestStartMs).toBeGreaterThanOrEqual(before);
    });

    it('returns the config unchanged', () => {
      const config = makeConfig();
      expect(interceptor.onRequest(config)).toBe(config);
    });
  });

  describe('onResponse', () => {
    it('logs status, method, and URL at requestLogLevel', () => {
      const config = makeConfig({ _requestStartMs: Date.now() - 100 });
      interceptor.onResponse({ status: 200, config } as AxiosResponse);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('200'), expect.anything());
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('GET'), expect.anything());
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('https://example.com/api'), expect.anything());
    });

    it('passes structured http metadata as second argument', () => {
      const config = makeConfig({ _requestStartMs: Date.now() - 50 });
      interceptor.onRequest(config);
      interceptor.onResponse({ status: 200, config } as AxiosResponse);
      const meta = (mockLogger.info.mock.calls[1] as unknown[])[1] as { http: Record<string, unknown> };
      expect(meta.http.method).toBe('GET');
      expect(meta.http.url).toBe('https://example.com/api');
      expect(meta.http.status).toBe(200);
      expect(typeof meta.http.elapsedMs).toBe('number');
    });

    it('includes elapsed time when start timestamp is present', () => {
      jest.useFakeTimers();
      const startTime = Date.now();
      jest.advanceTimersByTime(150);
      const config = makeConfig({ _requestStartMs: startTime });
      interceptor.onResponse({ status: 200, config } as AxiosResponse);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('150ms'), expect.anything());
      jest.useRealTimers();
    });

    it('omits elapsed time when start timestamp is absent', () => {
      const config = makeConfig();
      interceptor.onResponse({ status: 200, config } as AxiosResponse);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.not.stringContaining('ms'), expect.anything());
    });

    it('returns the response unchanged', () => {
      const response = { status: 200, config: makeConfig() } as AxiosResponse;
      expect(interceptor.onResponse(response)).toBe(response);
    });
  });

  describe('onResponseError', () => {
    it('logs HTTP error status, method, and URL at errorLogLevel', () => {
      const error = { response: { status: 401 }, config: makeConfig({ method: 'get', url: 'https://example.com/api' }) };
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('401'), expect.anything());
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('GET'), expect.anything());
    });

    it('passes structured http metadata and a flattened error summary as second argument', () => {
      const error = {
        response: { status: 401, data: { message: 'Unauthorized' } },
        config: makeConfig({ method: 'get', url: 'https://example.com/api' }),
        code: 'ERR_BAD_REQUEST',
        message: 'Request failed with status code 401',
      };
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          http: expect.objectContaining({ method: 'GET', url: 'https://example.com/api', status: 401 }),
          error: {
            code: 'ERR_BAD_REQUEST',
            message: 'Request failed with status code 401',
            responseStatus: 401,
            responseData: { message: 'Unauthorized' },
          },
        }),
      );
    });

    it('produces a JSON-serializable log payload even when the axios error has circular references', () => {
      // Reproduce the cycle that the real axios error has:
      // error.request === error.response.request === error.config.request.
      const request: Record<string, unknown> = { _header: 'GET /api HTTP/1.1' };
      const config = makeConfig({ method: 'get', url: 'https://example.com/api' }) as unknown as Record<string, unknown>;
      config.request = request;
      const response: Record<string, unknown> = { status: 500, data: { code: 'INTERNAL' }, request };
      const error: Record<string, unknown> = {
        message: 'Request failed with status code 500',
        code: 'ERR_BAD_RESPONSE',
        config,
        request,
        response,
      };
      request.parent = error; // close the cycle

      expect(() => interceptor.onResponseError(error)).toThrow();
      const meta = (mockLogger.error.mock.calls[0] as unknown[])[1];
      // The cycle is in the original error object; the logged meta must not include it.
      expect(() => JSON.stringify(meta)).not.toThrow();
    });

    it('logs the error code for network errors without an HTTP response', () => {
      const error = { code: 'ECONNRESET', config: makeConfig() };
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'), expect.anything());
    });

    it('includes elapsed time in error log when start timestamp is present', () => {
      jest.useFakeTimers();
      const startTime = Date.now();
      jest.advanceTimersByTime(80);
      const error = { response: { status: 500 }, config: makeConfig({ _requestStartMs: startTime }) };
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('80ms'), expect.anything());
      jest.useRealTimers();
    });

    it('re-throws the original error', () => {
      const error = { response: { status: 500 }, config: makeConfig() };
      let thrown: unknown;
      try { interceptor.onResponseError(error); } catch (e) { thrown = e; }
      expect(thrown).toBe(error);
    });
  });

  describe('retry deduplication', () => {
    it('logs the request only once when onRequest is called twice with the same config', () => {
      const config = makeConfig();
      interceptor.onRequest(config);
      interceptor.onRequest(config);
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('preserves the original _requestStartMs on the second onRequest call', () => {
      jest.useFakeTimers();
      const config = makeConfig();
      interceptor.onRequest(config);
      const originalTs = (config as { _requestStartMs?: number })._requestStartMs;
      jest.advanceTimersByTime(50);
      interceptor.onRequest(config);
      expect((config as { _requestStartMs?: number })._requestStartMs).toBe(originalTs);
      jest.useRealTimers();
    });

    it('logs the response only once when onResponse is called twice with the same config', () => {
      const config = makeConfig({ _requestStartMs: Date.now() });
      const response = { status: 200, config } as AxiosResponse;
      interceptor.onRequest(config);
      interceptor.onResponse(response);
      interceptor.onResponse(response);
      expect(mockLogger.info).toHaveBeenCalledTimes(2); // 1 request + 1 response
    });

    it('logs the error only once when onResponseError is called twice with the same config', () => {
      const config = makeConfig();
      const error = { response: { status: 401 }, config };
      interceptor.onRequest(config);
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(() => interceptor.onResponseError(error)).toThrow();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('elapsed time in the response log reflects the original request start, not the retry', () => {
      jest.useFakeTimers();
      const config = makeConfig();

      // First request at T=0
      interceptor.onRequest(config);
      jest.advanceTimersByTime(100);

      // Retry reuses the same config — simulates the auth interceptor re-entering the chain
      interceptor.onRequest(config);
      jest.advanceTimersByTime(50);

      // Response arrives 150ms after the original request
      const response = { status: 200, config } as AxiosResponse;
      interceptor.onResponse(response);

      expect(mockLogger.info).toHaveBeenLastCalledWith(expect.stringContaining('150ms'), expect.anything());
      jest.useRealTimers();
    });
  });

  describe('log levels', () => {
    it('uses the specified requestLogLevel for request and response logging', () => {
      const debugInterceptor = new LoggingInterceptor(mockLogger, 'debug', 'warn');
      const config = makeConfig({ _requestStartMs: Date.now() });
      debugInterceptor.onRequest(makeConfig());
      debugInterceptor.onResponse({ status: 200, config } as AxiosResponse);
      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('uses the specified errorLogLevel for error logging', () => {
      const warnInterceptor = new LoggingInterceptor(mockLogger, 'info', 'warn');
      const error = { response: { status: 500 }, config: makeConfig() };
      expect(() => warnInterceptor.onResponseError(error)).toThrow();
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});

describe('installLoggingInterceptors', () => {
  it('installs one request interceptor and one response interceptor', () => {
    const mockAxios = {
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as AxiosInstance;
    installLoggingInterceptors(mockAxios, makeMockLogger(), 'info', 'error');
    expect(mockAxios.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(mockAxios.interceptors.response.use).toHaveBeenCalledTimes(1);
  });

  it('passes onResponse and onResponseError as separate handlers to the response interceptor', () => {
    const mockAxios = {
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as AxiosInstance;
    installLoggingInterceptors(mockAxios, makeMockLogger(), 'info', 'error');
    const [onFulfilled, onRejected] = (mockAxios.interceptors.response.use as jest.Mock).mock.calls[0];
    expect(typeof onFulfilled).toBe('function');
    expect(typeof onRejected).toBe('function');
  });
});