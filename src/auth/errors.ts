/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

/**
 * Defines `cause` as a non-enumerable own property, matching native `Error.cause`
 * semantics (the platform keeps `cause` out of enumeration so it stays out of
 * serialization). A plain `this.cause = cause` assignment would make it enumerable,
 * causing `JSON.stringify` to walk into the cause — and if the cause is a raw axios
 * error (e.g. a failed token fetch), its circular `request`/socket/agent graph throws
 * "Converting circular structure to JSON". Keeping it non-enumerable leaves `.cause`
 * fully accessible for debugging while keeping the error serializable.
 */
function defineCause(target: Error, cause?: Error): void {
  Object.defineProperty(target, 'cause', {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

export class ClientSecretError extends Error {
  declare cause?: Error;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ClientSecretError';
    defineCause(this, cause);
  }
}

export class AccessTokenFetchError extends Error {
  declare cause?: Error;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'AccessTokenFetchError';
    defineCause(this, cause);
  }
}
