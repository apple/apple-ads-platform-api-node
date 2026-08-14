/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import fs from 'fs';
import jwt from 'jsonwebtoken';
import { AUTH_AUDIENCE, CLIENT_SECRET_EXPIRY_SECONDS, CLIENT_SECRET_ALGORITHM } from './constants';
import { ClientSecretError } from './errors';
import type { ClientSecretProvider } from './types';

export class EphemeralClientSecretProvider implements ClientSecretProvider {
  private constructor(
    private readonly privateKey: string,
    private readonly clientId: string,
    private readonly teamId: string,
    private readonly keyId: string,
  ) {}

  static async create(
    privateKeyPath: string,
    clientId: string,
    teamId: string,
    keyId: string,
  ): Promise<EphemeralClientSecretProvider> {
    if (!privateKeyPath) throw new ClientSecretError('privateKeyPath is required');
    if (!clientId) throw new ClientSecretError('clientId is required');
    if (!teamId) throw new ClientSecretError('teamId is required');
    if (!keyId) throw new ClientSecretError('keyId is required');

    let privateKey: string;
    try {
      privateKey = await fs.promises.readFile(privateKeyPath, 'utf8');
    } catch (err) {
      throw new ClientSecretError(`Failed to read private key from ${privateKeyPath}`, err as Error);
    }

    return new EphemeralClientSecretProvider(privateKey, clientId, teamId, keyId);
  }

  getClientSecret(): string {
    const now = Math.floor(Date.now() / 1000);
    try {
      return jwt.sign(
        {
          sub: this.clientId,
          iss: this.teamId,
          aud: AUTH_AUDIENCE,
          iat: now,
          exp: now + CLIENT_SECRET_EXPIRY_SECONDS,
        },
        this.privateKey,
        {
          algorithm: CLIENT_SECRET_ALGORITHM,
          keyid: this.keyId,
        },
      );
    } catch (err) {
      throw new ClientSecretError('Failed to sign client secret JWT', err as Error);
    }
  }
}