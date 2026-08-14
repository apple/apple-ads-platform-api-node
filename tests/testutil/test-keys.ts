/**
 * Copyright (c) 2026 Apple Inc. Licensed under MIT License.
 */

import crypto from 'crypto';

/**
 * Generates throwaway private keys as PEM strings for tests.
 *
 * Keys are generated fresh on each call so that no key material lives in the
 * repository (which would otherwise trip credential-scanning tools). The
 * emitted PEM formats match the output of the corresponding OpenSSL commands:
 *
 *   - {@link generateEcPrivateKeyPem} — SEC1 `EC PRIVATE KEY`, equivalent to
 *     `openssl ecparam -genkey -name prime256v1 -noout`
 *   - {@link generateRsaPrivateKeyPem} — PKCS#1 `RSA PRIVATE KEY`, equivalent to
 *     `openssl genrsa 2048`
 */

const EC_CURVE = 'prime256v1';
const RSA_MODULUS_LENGTH = 2048;

/**
 * Generates a fresh P-256 (prime256v1 / secp256r1) EC private key in SEC1 PEM
 * form. This is the key type expected by `EphemeralClientSecretProvider` for
 * ES256 signing.
 */
export function generateEcPrivateKeyPem(): string {
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: EC_CURVE,
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey;
}

/**
 * Generates a fresh 2048-bit RSA private key in PKCS#1 PEM form. Used to
 * exercise the negative path where a non-EC key must be rejected.
 */
export function generateRsaPrivateKeyPem(): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey;
}