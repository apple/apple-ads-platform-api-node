/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import { AccessTokenFetchError, ClientSecretError } from '../../src/auth/errors';

/** A cause object that cycles, mirroring a raw axios error from a failed token fetch. */
function cyclicCause(): Error {
  const socket: Record<string, unknown> = { _httpMessage: null };
  const request: Record<string, unknown> = { socket };
  socket._httpMessage = request;
  const error = new Error('Request failed with status code 401') as Error & Record<string, unknown>;
  error.request = request;
  error.response = { status: 401, request };
  return error;
}

describe.each([
  ['AccessTokenFetchError', AccessTokenFetchError],
  ['ClientSecretError', ClientSecretError],
] as const)('%s', (name, ErrorClass) => {
  it('sets the error name', () => {
    expect(new ErrorClass('boom').name).toBe(name);
  });

  it('keeps cause programmatically accessible', () => {
    const cause = new Error('root cause');
    expect(new ErrorClass('boom', cause).cause).toBe(cause);
  });

  it('defines cause as a non-enumerable property', () => {
    const err = new ErrorClass('boom', new Error('root cause'));
    expect(Object.keys(err)).not.toContain('cause');
    expect(Object.getOwnPropertyDescriptor(err, 'cause')?.enumerable).toBe(false);
  });

  it('is JSON-serializable even when the cause has circular references', () => {
    const err = new ErrorClass('boom', cyclicCause());
    // The cause itself genuinely cycles...
    expect(() => JSON.stringify(err.cause)).toThrow(/circular/i);
    // ...but the error is serializable because cause is excluded from enumeration.
    expect(() => JSON.stringify(err)).not.toThrow();
  });
});
