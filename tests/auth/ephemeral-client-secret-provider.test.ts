/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import fs from 'fs';
import jwt from 'jsonwebtoken';
import { EphemeralClientSecretProvider } from '../../src/auth/ephemeral-client-secret-provider';
import { ClientSecretError } from '../../src/auth/errors';
import { AUTH_AUDIENCE, CLIENT_SECRET_EXPIRY_SECONDS } from '../../src/auth/constants';
import { generateEcPrivateKeyPem, generateRsaPrivateKeyPem } from '../testutil/test-keys';

// Generated fresh so no key material lives in the repository.
const TEST_PRIVATE_KEY = generateEcPrivateKeyPem();
const TEST_RSA_PRIVATE_KEY = generateRsaPrivateKeyPem();

const TEST_CLIENT_ID = 'test-client-id';
const TEST_TEAM_ID = 'TEST_TEAM_ID';
const TEST_KEY_ID = 'TEST_KEY_ID';
const FAKE_KEY_PATH = '/fake/path/key.pem';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));
const mockReadFile = fs.promises.readFile as jest.Mock;

describe('EphemeralClientSecretProvider', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(TEST_PRIVATE_KEY);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('reads the private key from the given path', async () => {
      await EphemeralClientSecretProvider.create(FAKE_KEY_PATH, TEST_CLIENT_ID, TEST_TEAM_ID, TEST_KEY_ID);
      expect(mockReadFile).toHaveBeenCalledWith(FAKE_KEY_PATH, 'utf8');
    });

    it.each([
      ['privateKeyPath', '', TEST_CLIENT_ID, TEST_TEAM_ID, TEST_KEY_ID],
      ['clientId', FAKE_KEY_PATH, '', TEST_TEAM_ID, TEST_KEY_ID],
      ['teamId', FAKE_KEY_PATH, TEST_CLIENT_ID, '', TEST_KEY_ID],
      ['keyId', FAKE_KEY_PATH, TEST_CLIENT_ID, TEST_TEAM_ID, ''],
    ])('throws ClientSecretError when %s is empty', async (_, keyPath, clientId, teamId, keyId) => {
      await expect(EphemeralClientSecretProvider.create(keyPath, clientId, teamId, keyId))
        .rejects.toThrow(ClientSecretError);
    });

    it('throws ClientSecretError when the key file cannot be read', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      await expect(EphemeralClientSecretProvider.create(FAKE_KEY_PATH, TEST_CLIENT_ID, TEST_TEAM_ID, TEST_KEY_ID))
        .rejects.toThrow(ClientSecretError);
    });
  });

  describe('getClientSecret', () => {
    let provider: EphemeralClientSecretProvider;

    beforeEach(async () => {
      provider = await EphemeralClientSecretProvider.create(
        FAKE_KEY_PATH,
        TEST_CLIENT_ID,
        TEST_TEAM_ID,
        TEST_KEY_ID,
      );
    });

    it('returns a signed JWT string', () => {
      const secret = provider.getClientSecret();
      expect(typeof secret).toBe('string');
      expect(secret.split('.').length).toBe(3);
    });

    it('signs with ES256 and the correct kid', () => {
      const secret = provider.getClientSecret();
      const decoded = jwt.decode(secret, { complete: true });
      expect(decoded?.header.alg).toBe('ES256');
      expect(decoded?.header.kid).toBe(TEST_KEY_ID);
    });

    it('sets the correct claims', () => {
      const beforeMs = Math.floor(Date.now() / 1000);
      const secret = provider.getClientSecret();
      const afterMs = Math.floor(Date.now() / 1000);

      const payload = jwt.decode(secret) as Record<string, unknown>;
      expect(payload.sub).toBe(TEST_CLIENT_ID);
      expect(payload.iss).toBe(TEST_TEAM_ID);
      expect(payload.aud).toBe(AUTH_AUDIENCE);
      expect(payload.iat).toBeGreaterThanOrEqual(beforeMs);
      expect(payload.iat).toBeLessThanOrEqual(afterMs);
      expect(payload.exp).toBeCloseTo(
        (payload.iat as number) + CLIENT_SECRET_EXPIRY_SECONDS,
        -1,
      );
    });

    it('throws ClientSecretError when signing fails', async () => {
      mockReadFile.mockResolvedValue('not-a-valid-pem-key');
      const badProvider = await EphemeralClientSecretProvider.create(
        FAKE_KEY_PATH,
        TEST_CLIENT_ID,
        TEST_TEAM_ID,
        TEST_KEY_ID,
      );
      expect(() => badProvider.getClientSecret()).toThrow(ClientSecretError);
    });

    it('throws ClientSecretError when the key is not an EC key (e.g. RSA)', async () => {
      mockReadFile.mockResolvedValue(TEST_RSA_PRIVATE_KEY);
      const rsaProvider = await EphemeralClientSecretProvider.create(
        FAKE_KEY_PATH,
        TEST_CLIENT_ID,
        TEST_TEAM_ID,
        TEST_KEY_ID,
      );
      expect(() => rsaProvider.getClientSecret()).toThrow(ClientSecretError);
    });
  });
});