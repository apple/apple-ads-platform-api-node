/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { GRANT_TYPE, OAUTH_SCOPE, TOKEN_ENDPOINT_PATH, CONTENT_TYPE_HEADER, FORM_URL_ENCODED } from './constants';
import { AccessTokenFetchError } from './errors';
import type { AccessTokenResponse, ClientSecretProvider, FetchedToken } from './types';

export class AccessTokenFetcher {
  private readonly axiosInstance: AxiosInstance;

  constructor(
    private readonly authBaseUrl: string,
    private readonly clientId: string,
    private readonly clientSecretProvider: ClientSecretProvider,
    axiosInstance?: AxiosInstance,
  ) {
    this.axiosInstance = axiosInstance ?? axios.create();
  }

  async getAccessToken(): Promise<FetchedToken> {
    let clientSecret: string;
    try {
      clientSecret = this.clientSecretProvider.getClientSecret();
    } catch (err) {
      throw new AccessTokenFetchError('Failed to obtain client secret', err as Error);
    }

    const body = new URLSearchParams({
      grant_type: GRANT_TYPE,
      client_id: this.clientId,
      client_secret: clientSecret,
      scope: OAUTH_SCOPE,
    });

    let response;
    try {
      response = await this.axiosInstance.post<AccessTokenResponse>(
        `${this.authBaseUrl}${TOKEN_ENDPOINT_PATH}`,
        body.toString(),
        { headers: { [CONTENT_TYPE_HEADER]: FORM_URL_ENCODED } },
      );
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;
      const responseBody = axiosErr.response?.data
        ? JSON.stringify(axiosErr.response.data)
        : '(no response body)';
      const message = status
        ? `Fetching access token failed with status ${status}, body: ${responseBody}`
        : `Network error while fetching access token: ${axiosErr.message}`;
      throw new AccessTokenFetchError(message, axiosErr);
    }

    if (!response.data?.access_token) {
      throw new AccessTokenFetchError(
        'Unexpected response: access_token missing from token endpoint response',
      );
    }

    const expiresIn = response.data.expires_in;
    if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new AccessTokenFetchError(
        `Unexpected response: expires_in missing or invalid in token endpoint response (got ${expiresIn})`,
      );
    }

    return {
      token: response.data.access_token,
      expiresInSeconds: expiresIn,
    };
  }
}