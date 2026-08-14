/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import type { AxiosInstance } from 'axios';
import { ApiRequestError, toApiRequestError } from '../src/errors';
import { installErrorInterceptor } from '../src/error-interceptor';

/**
 * Builds an object graph mirroring a real axios error from a keep-alive 4xx response,
 * including the two circular reference paths that make JSON.stringify throw:
 *   - request.socket._httpMessage === request          (socket <-> request)
 *   - config.httpAgent.freeSockets[*] === socket        (agent <-> socket <-> request <-> agent)
 *   - response.request === error.request                (shared ClientRequest)
 */
function cyclicAxiosError(): Record<string, unknown> {
  const socket: Record<string, unknown> = { _httpMessage: null };
  const agent: Record<string, unknown> = { freeSockets: {}, sockets: {}, requests: {} };
  const request: Record<string, unknown> = { method: 'POST', path: '/v1/campaigns', agent, socket };
  socket._httpMessage = request;
  (agent.freeSockets as Record<string, unknown[]>)['api.ads.apple.com:443:'] = [socket];
  const config: Record<string, unknown> = {
    method: 'post',
    url: 'https://api.ads.apple.com/v1/campaigns',
    httpAgent: agent,
    headers: {},
  };
  const response: Record<string, unknown> = {
    status: 400,
    statusText: 'Bad Request',
    data: { error: { messages: ['Invalid campaign'] } },
    headers: {},
    config,
    request,
  };
  request.res = response;
  const error: Record<string, unknown> = {
    message: 'Request failed with status code 400',
    code: 'ERR_BAD_REQUEST',
    isAxiosError: true,
    config,
    request,
    response,
  };
  return error;
}

describe('toApiRequestError', () => {
  it('returns an ApiRequestError', () => {
    expect(toApiRequestError(cyclicAxiosError())).toBeInstanceOf(ApiRequestError);
  });

  it('produces a JSON-serializable error even when the source has circular references', () => {
    const source = cyclicAxiosError();
    // Sanity check: the source genuinely cycles.
    expect(() => JSON.stringify(source)).toThrow(/circular/i);

    const converted = toApiRequestError(source);
    expect(() => JSON.stringify(converted)).not.toThrow();
  });

  it('maps the axios error fields onto flat scalars', () => {
    const converted = toApiRequestError(cyclicAxiosError());
    expect(converted.message).toBe('Request failed with status code 400');
    expect(converted.code).toBe('ERR_BAD_REQUEST');
    expect(converted.status).toBe(400);
    expect(converted.statusText).toBe('Bad Request');
    expect(converted.data).toEqual({ error: { messages: ['Invalid campaign'] } });
    expect(converted.method).toBe('POST');
    expect(converted.url).toBe('https://api.ads.apple.com/v1/campaigns');
  });

  it('does not retain a reference to the raw request, socket, response, or agent', () => {
    const converted = toApiRequestError(cyclicAxiosError()) as unknown as Record<string, unknown>;
    expect(converted.request).toBeUndefined();
    expect(converted.response).toBeUndefined();
    expect(converted.config).toBeUndefined();
  });

  it('handles a network error with no response (status/data undefined, code/message kept)', () => {
    const networkError = { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED', config: { method: 'get', url: '/x' } };
    const converted = toApiRequestError(networkError);
    expect(converted.status).toBeUndefined();
    expect(converted.statusText).toBeUndefined();
    expect(converted.data).toBeUndefined();
    expect(converted.code).toBe('ECONNREFUSED');
    expect(converted.message).toBe('connect ECONNREFUSED');
    expect(converted.method).toBe('GET');
    expect(() => JSON.stringify(converted)).not.toThrow();
  });

  it('is idempotent: an existing ApiRequestError is returned unchanged', () => {
    const original = new ApiRequestError('boom', { status: 500 });
    expect(toApiRequestError(original)).toBe(original);
  });

  it('falls back to a string message for non-Error, non-axios throw values', () => {
    expect(toApiRequestError('plain string').message).toBe('plain string');
    expect(toApiRequestError(null).message).toBe('null');
  });
});

describe('installErrorInterceptor', () => {
  function mockAxios(): { instance: AxiosInstance; getOnRejected: () => (error: unknown) => unknown } {
    const use = jest.fn();
    const instance = { interceptors: { response: { use } } } as unknown as AxiosInstance;
    return {
      instance,
      getOnRejected: () => (use.mock.calls[0] as unknown[])[1] as (error: unknown) => unknown,
    };
  }

  it('registers a single response interceptor with only a rejected handler', () => {
    const { instance } = mockAxios();
    installErrorInterceptor(instance);
    const use = instance.interceptors.response.use as jest.Mock;
    expect(use).toHaveBeenCalledTimes(1);
    expect(use.mock.calls[0][0]).toBeUndefined(); // no fulfilled handler
    expect(typeof use.mock.calls[0][1]).toBe('function');
  });

  it('converts a rejection into a serializable ApiRequestError', () => {
    const { instance, getOnRejected } = mockAxios();
    installErrorInterceptor(instance);
    const onRejected = getOnRejected();

    let thrown: unknown;
    try {
      onRejected(cyclicAxiosError());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(() => JSON.stringify(thrown)).not.toThrow();
  });
});
