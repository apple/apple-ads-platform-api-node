# Apple Ads Platform API Node

A Node.js / TypeScript client library for the Apple Ads Platform API.

## Model and Endpoint Documentation

This README serves as the primary documentation for installation and usage of this library. For
information on data models and API endpoints, see the
[Apple Ads Platform API documentation](https://developer.apple.com/documentation/apple-ads-platform-api)
found on Apple's developer website.

## Installation

Install this library from npm. Like nearly any software dependency, you should pin a
specific version and update it only when you explicitly intend to do so.

```bash
npm install @apple/apple-ads-platform
```

Or add it to your `package.json` `dependencies`:

```json
{
  "dependencies": {
    "@apple/apple-ads-platform": "VERSION"
  }
}
```

The library ships with TypeScript type declarations — no separate `@types/...` package is needed.

## Getting Started

This library makes it easy to create an [`AppleAdsApi`](src/api/apple-ads-api.ts) instance backed by
an [`axios`](https://axios-http.com/) HTTP client that is ready to call the Apple Ads Platform API.
The [`createAppleAdsApi`](src/factory.ts) factory accepts the information needed for authentication
along with various optional settings. The resulting client performs the OAuth flow transparently.

### Client Construction

You can instantiate a client in three ways, selected by the `authMode` field on the options object.

#### Using Your Private Key

The first way to create the client is to provide a path to your `.pem` private key file along with
the rest of the associated metadata. The library reads the key once at construction time and
generates a fresh client secret every time a new access token is needed.

```ts
import { createAppleAdsApi } from '@apple/apple-ads-platform';

const api = await createAppleAdsApi({
  authMode: 'key',
  clientId: '...',
  teamId: '...',
  keyId: '...',
  privateKeyPath: '/path/to/your/private/key.pem',
});
```

#### Using a Custom ClientSecretProvider

If you wish to generate client secrets in a different way (for example generating them offline and
using a fixed one at runtime, or using a separate service for signing), pass an implementation of
[`ClientSecretProvider`](src/auth/types.ts). The library calls it whenever a client secret is needed
for fetching a new access token.

```ts
import { createAppleAdsApi, ClientSecretProvider } from '@apple/apple-ads-platform';

const clientSecretProvider: ClientSecretProvider = {
  getClientSecret: () => '...',
};

const api = await createAppleAdsApi({
  authMode: 'clientSecret',
  clientId: '...',
  clientSecretProvider,
});
```

#### Implementing OAuth Yourself

We recommend letting the library handle the OAuth flow. If you have specific requirements, you can
implement it yourself by constructing the client with an
[`AccessTokenProvider`](src/auth/types.ts). In this case, the library calls it before every API
request in order to attach an access token as an HTTP header.

```ts
import { createAppleAdsApi, AccessTokenProvider } from '@apple/apple-ads-platform';

const accessTokenProvider: AccessTokenProvider = new MyAccessTokenProvider(/* ... */);

const api = await createAppleAdsApi({
  authMode: 'token',
  accessTokenProvider,
});
```

### Optional Settings

All options below have sensible defaults and may be omitted. Options are passed as fields on the
same options object.

#### Common (all `authMode` values)

| Field                 | Type                                | Description                                                                                                                                                                              | Default                        |
|-----------------------|-------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| `apiTimeout`          | `number` (ms)                       | Timeout for API requests.                                                                                                                                                                | `5000`                         |
| `maxSockets`          | `number`                            | Maximum open sockets per host for the API connection pool.                                                                                                                               | `50`                           |
| `maxFreeSockets`      | `number`                            | Maximum idle keep-alive sockets per host for the API connection pool.                                                                                                                    | `10`                           |
| `freeSocketTimeout`   | `number` (ms)                       | Idle sockets are evicted from the API pool after this many milliseconds. Set below the server's keep-alive idle timeout to avoid stale connection errors.                                | `30000`                        |
| `apiAxiosCustomizer`  | `(instance: AxiosInstance) => void` | Callback applied to the main API axios instance after it is created, allowing additional customization (proxy setup, additional interceptors, headers, etc.). See the [axios](https://axios-http.com/docs/interceptors) documentation for what is possible. | None applied                   |
| `logger`              | `Logger \| null`                    | Logger used by the request/response logging interceptors. Pass `null` to disable logging entirely. Any object implementing the [`Logger`](src/auth/types.ts) interface works (compatible with `console`, `winston`, and `pino` with a small wrapper). The `Authorization` header is never logged. | `console`                      |
| `requestLogLevel`     | `'debug' \| 'info' \| 'warn' \| 'error'` | Log level for request start and successful responses. Applies to both API and auth axios instances.                                                                                     | `'info'`                       |
| `errorLogLevel`       | `'debug' \| 'info' \| 'warn' \| 'error'` | Log level for request errors. Applies to both API and auth axios instances.                                                                                                             | `'error'`                      |

#### Additional for `authMode: 'key'` and `authMode: 'clientSecret'`

| Field                 | Type                                | Description                                                                             | Default                          |
|-----------------------|-------------------------------------|-----------------------------------------------------------------------------------------|----------------------------------|
| `authTimeout`         | `number` (ms)                       | Timeout for token requests to the auth server.                                          | `5000`                           |
| `authAxiosCustomizer` | `(instance: AxiosInstance) => void` | Same as `apiAxiosCustomizer` but for the axios instance used for auth token requests.   | None applied                     |

#### Example with Optional Settings

```ts
const api = await createAppleAdsApi({
  authMode: 'key',
  clientId: '...',
  teamId: '...',
  keyId: '...',
  privateKeyPath: '/path/to/your/private/key.pem',
  apiTimeout: 10_000,
  requestLogLevel: 'debug',
});
```

## Examples

The `xApContext` header identifies the ad account to which the request applies.
It is a plain string — construct it as required by the API for the endpoint you are calling.

#### Query Running Campaigns

```ts
import {
  createAppleAdsApi,
  QueryRequest,
  QueryFilterOperator,
  CampaignSystemStatus,
} from '@apple/apple-ads-platform';

const api = await createAppleAdsApi({
  authMode: 'key',
  clientId: '...',
  teamId: '...',
  keyId: '...',
  privateKeyPath: '/path/to/your/private/key.pem',
});

const runningCampaignsRequest: QueryRequest = {
  filters: [
    {
      field: 'systemStatus',
      operator: QueryFilterOperator.Equals,
      value: CampaignSystemStatus.Running,
    },
  ],
};

const xApContext = '...'; // e.g. "adAccountId=12345678;" 

const response = await api.campaignsQueryPost(xApContext, runningCampaignsRequest);
```

#### Get a Business Brand by ID

```ts
const api = await createAppleAdsApi({
  authMode: 'key',
  clientId: '...',
  teamId: '...',
  keyId: '...',
  privateKeyPath: '/path/to/your/private/key.pem',
});

const brandId = '...';
const xApContext = '...';

const response = await api.getBrand(xApContext, brandId);
```

#### Update a Keyword Bid

```ts
import { createAppleAdsApi, KeywordUpdate } from '@apple/apple-ads-platform';

const api = await createAppleAdsApi({
  authMode: 'key',
  clientId: '...',
  teamId: '...',
  keyId: '...',
  privateKeyPath: '/path/to/your/private/key.pem',
});

const keywordId = '...';
const xApContext = '...';

const keywordUpdate: KeywordUpdate = {
  bid: { amount: '1.00', currency: 'USD' },
};

const response = await api.keywordsIdPut(keywordId, xApContext, keywordUpdate);
```

## Error Handling

Every failed request — non-2xx response or transport/network failure — is converted into an
[`ApiRequestError`](src/errors.ts) before it escapes the library. The error is flat and fully
serializable (safe to `JSON.stringify` and to log): it carries only scalar fields (`code`,
`status`, `statusText`, `method`, `url`) plus the server's response payload (`data`). It never
holds a reference to the underlying axios error, socket, or connection-pool agent.

```ts
import { ApiRequestError } from '@apple/apple-ads-platform';

try {
  await api.getBrand(xApContext, brandId);
} catch (err) {
  if (err instanceof ApiRequestError) {
    console.error(err.status, err.data);
  }
  throw err;
}
```

## Keeping Your Credentials Secure

Your private key and client secrets are sensitive credentials. Don't store them as plain text.
Treat access tokens as secrets too. The library does not log any of these values (the
`Authorization` header is explicitly omitted from log output). Do the same if you choose to add any
additional logging or observability through additional customization of the client.

## Reusing the Client

The client is safe to use concurrently across many in-flight requests. Create a single instance
per process and share it across your entire application. This maximizes the benefit of the
underlying keep-alive connection pool and minimizes calls to the OAuth server. If you provide your
own `AccessTokenProvider`, concurrency behavior depends on the implementation.

## Enum Types

The model definitions use TypeScript `enum` types with string values (see
[`src/model`](src/model)) throughout the API model. As the API itself evolves over time, new enum
values may appear. Because the library does not throw on unknown enum values during
deserialization, a response can contain a string that does not match any current member of the
enum. Compare against the known enum members with care, and keep your library up to date to ensure
you have model types that match the latest version of the API.

# Node Commands

## Testing

### `npm test`
Run the full test suite once and report results. Use this for CI or a quick local check.

### `npm run test:coverage`
Run the full test suite and generate a code-coverage report under `coverage/`. Open `coverage/lcov-report/index.html` in a browser for a detailed line-by-line view.

## Building

### `npm run build`
Compile TypeScript source in `src/` to JavaScript in `dist/`, including type declaration files (`.d.ts`). The `prebuild` step automatically cleans `dist/` first. Run this before publishing.

## Dependency Management

### `npm run update-deps`
Check for newer versions of all dependencies and interactively upgrade `package.json`, then install the updated packages. Powered by `npm-check-updates` (`ncu`). Review and test after running — major-version bumps may contain breaking changes.

## License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.
