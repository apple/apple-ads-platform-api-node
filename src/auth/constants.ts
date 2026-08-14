/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

export const AUTHORIZATION_HEADER = 'Authorization';
export const BEARER_PREFIX = 'Bearer ';
export const GRANT_TYPE = 'client_credentials';
export const OAUTH_SCOPE = 'searchadsorg';
export const AUTH_AUDIENCE = 'https://appleid.apple.com';
export const CLIENT_SECRET_EXPIRY_SECONDS = 86400 * 180; // 180 days
export const CLIENT_SECRET_ALGORITHM = 'ES256';
export const TOKEN_ENDPOINT_PATH = 'auth/oauth2/token';
export const CONTENT_TYPE_HEADER = 'Content-Type';
export const FORM_URL_ENCODED = 'application/x-www-form-urlencoded';