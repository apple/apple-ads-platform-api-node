/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { AccessTokenFetcher } from '../../src/auth/access-token-fetcher';
import { AccessTokenFetchError } from '../../src/auth/errors';
import { GRANT_TYPE, OAUTH_SCOPE } from '../../src/auth/constants';
import type { ClientSecretProvider } from '../../src/auth/types';

const AUTH_BASE_URL = 'https://appleid.apple.com/';
const TOKEN_URL = `${AUTH_BASE_URL}auth/oauth2/token`;
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test.client.secret';

const mockSecretProvider: ClientSecretProvider = {
  getClientSecret: jest.fn().mockReturnValue(CLIENT_SECRET),
};

const mockTokenResponse = {
  access_token: 'test-access-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: OAUTH_SCOPE,
};

describe('AccessTokenFetcher', () => {
  let mockAxios: MockAdapter;
  let fetcher: AccessTokenFetcher;
  let axiosInstance: ReturnType<typeof axios.create>;

  beforeEach(() => {
    axiosInstance = axios.create();
    mockAxios = new MockAdapter(axiosInstance);
    (mockSecretProvider.getClientSecret as jest.Mock).mockReturnValue(CLIENT_SECRET);
    fetcher = new AccessTokenFetcher(AUTH_BASE_URL, CLIENT_ID, mockSecretProvider, axiosInstance);
  });

  afterEach(() => {
    mockAxios.restore();
    jest.resetAllMocks();
  });

  describe('getAccessToken', () => {
    it('posts to the correct token URL', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, mockTokenResponse);
      await fetcher.getAccessToken();
      expect(mockAxios.history.post[0].url).toBe(TOKEN_URL);
    });

    it('sends correct form fields', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, mockTokenResponse);
      await fetcher.getAccessToken();

      const postedBody = new URLSearchParams(mockAxios.history.post[0].data as string);
      expect(postedBody.get('grant_type')).toBe(GRANT_TYPE);
      expect(postedBody.get('client_id')).toBe(CLIENT_ID);
      expect(postedBody.get('client_secret')).toBe(CLIENT_SECRET);
      expect(postedBody.get('scope')).toBe(OAUTH_SCOPE);
    });

    it('sends application/x-www-form-urlencoded content type', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, mockTokenResponse);
      await fetcher.getAccessToken();
      expect(mockAxios.history.post[0].headers?.['Content-Type']).toContain(
        'application/x-www-form-urlencoded',
      );
    });

    it('returns a FetchedToken with the access token and expiry', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, mockTokenResponse);
      const result = await fetcher.getAccessToken();
      expect(result.token).toBe('test-access-token');
      expect(result.expiresInSeconds).toBe(3600);
    });

    it('throws AccessTokenFetchError when client secret generation fails', async () => {
      (mockSecretProvider.getClientSecret as jest.Mock).mockImplementation(() => {
        throw new Error('key error');
      });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError with status on non-2xx response', async () => {
      mockAxios.onPost(TOKEN_URL).reply(401, { error: 'invalid_client' });
      const error = await fetcher.getAccessToken().catch((e) => e);
      expect(error).toBeInstanceOf(AccessTokenFetchError);
      expect(error.message).toContain('401');
    });

    it('throws AccessTokenFetchError on network error', async () => {
      mockAxios.onPost(TOKEN_URL).networkError();
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError when access_token is missing from response', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, { token_type: 'Bearer', expires_in: 3600 });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError when expires_in is missing from response', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, { access_token: 'tok', token_type: 'Bearer' });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError when expires_in is zero', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 0 });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError when expires_in is negative', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, { access_token: 'tok', token_type: 'Bearer', expires_in: -1 });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });

    it('throws AccessTokenFetchError when expires_in is not a finite number', async () => {
      mockAxios.onPost(TOKEN_URL).reply(200, { access_token: 'tok', token_type: 'Bearer', expires_in: Infinity });
      await expect(fetcher.getAccessToken()).rejects.toThrow(AccessTokenFetchError);
    });
  });
});