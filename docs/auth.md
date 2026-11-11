# Auth

This page covers who may call the service and how a person signs in: the three login modes,
the API key, API tokens, the session cookie, the CSRF header and the request id every `/auth`
reply carries. [Setup](setup.md) starts the service with an `API_KEY` first, and its
[configuration](setup.md#configuration) table lists every variable this page uses.

## What it is and when to turn it on

Every request to `/api` needs one of three credentials, and the `/auth` routes handle sign-in
for the web app:

- **The API key**, `API_KEY` in `.env`. One secret for one client, such as a script or an agent.
  It is accepted in every login mode.
- **An API token**, minted for a signed-in person on the web app's Tokens page or with
  `POST /auth/tokens`. Each token has a name, can be revoked, and records when it was last used.
- **A session cookie**, set when someone signs in at `/login`. The web app sends it on every
  call. A write made with the cookie must also send the CSRF header.

`AUTH_MODE` picks the login. One mode is on at a time, and an unset `AUTH_MODE` is `none`:

- **none**, the default. There is no sign-in: the web app says so, and only the API key or an
  existing API token opens `/api`.
- **password**, one user who signs in with one password. The password is never stored; `.env`
  holds its scrypt hash.
- **oidc**, one account at a standard OpenID Connect provider. It is let in by its subject or by
  an email the provider marks verified.

Turn sign-in on when a person needs the web app. A service that only a script calls needs the
API key and nothing else, so mode `none` is enough.

### The session cookie

A successful sign-in sets a cookie named `template-service_session`. Its value is a random
session id signed with a secret, so a forged value is refused. The cookie is `HttpOnly`,
`SameSite=Lax` and `Path=/`, and it lasts 30 days. It is marked `Secure` when the request came
over HTTPS or when `AUTH_COOKIE_SECURE=true` is set. The server keeps only a SHA-256 hash of each
session id, and the signing secret lives in the `app_config` table, created on first use. Sign-out
deletes the session and clears the cookie.

### The CSRF header

Every unsafe method on `/auth` (`POST`, `DELETE` and the rest) must send the header
`x-app-csrf: 1`, in every mode, or the reply is a 403. On `/api`, a write authenticated by the
session cookie must send it too; a write with an API key or a token does not need it, because
another site cannot attach those. A page on another origin cannot add a custom header to a
cross-site request, and the service answers no CORS preflight, so the header shows the request
came from this app's own page.

### The request id

Every `/auth` reply carries an `x-request-id` header, and so does every 403, 404 and 500 from
those routes. It is the trace id that the request's log lines carry, so a caller can quote it when
it asks about a failure. A caller may send its own `x-request-id`: it is kept only when it matches
`[A-Za-z0-9._:-]{1,64}`, and otherwise a new UUID replaces it.

## Setup from zero

Each mode needs `.env` first. Copy `.env.example` to `.env` as [setup](setup.md#create-env) says.

### Password sign-in

Set the mode and the password with one command, then start the service:

```sh
bun run set-password
bun run serve
```

`set-password` asks for the password twice, without echoing it. It writes `AUTH_PASSWORD_HASH`
into `.env`, and it writes `AUTH_MODE=password` when no mode is set. The password itself is never
written or printed. A password shorter than 8 characters is still saved, with a note. Open
`http://localhost:3000/login` and sign in with it.

Password mode does not need `API_KEY`. Keep one anyway if a script calls `/api`.

### OIDC sign-in

Register the service as a client at your provider. Give it the callback
`http://localhost:3000/auth/oidc/callback`, or the public URL of your service with the same path.
Then set these in `.env`:

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://issuer.example.com
OIDC_CLIENT_ID=<the client id>
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
OIDC_ALLOWED_EMAIL=you@example.com
```

Set `OIDC_ALLOWED_SUBJECT` instead of `OIDC_ALLOWED_EMAIL` if your provider's subject is what you
want to pin. Setting both means both must match. Leave `OIDC_CLIENT_SECRET` unset for a public
client, which proves itself with PKCE alone. Then run `bun run serve` and open `/login`, which
shows a button to continue to the provider.

The service fetches the provider's discovery document on the first sign-in. Its `issuer` must
match `OIDC_ISSUER` exactly, apart from a trailing slash, or sign-in is refused.

### The API key

```sh
bun run setApiKey --burn-after-reading
bun run serve
```

The key is generated, saved as `API_KEY` in `.env` and shown once, and the screen clears after 30
seconds. [Setup](setup.md#the-first-run) walks through the first run. Running the command again
replaces the key, and every client that used the old one gets a 401 until it is updated.

### API tokens

Sign in on the web app and create a token on the Tokens page. The token is shown once, when it is
created, and is never shown again. A script can mint one with the session cookie from a signed-in
browser. Copy the cookie's value from the browser's developer tools:

```sh
curl -s -X POST localhost:3000/auth/tokens \
  -H "x-app-csrf: 1" \
  -H "content-type: application/json" \
  -b "template-service_session=<the cookie value>" \
  -d '{"name":"laptop agent"}'
```

The reply's `data.token` is the token, and `data.summary` lists it by its id, name, prefix and
times. A token needs a name of 1 to 80 characters after trimming. A token cannot mint another
token: minting takes a session, and a bearer token is not one. Send the token as
`Authorization: Bearer <token>` to `/api`.

## Configuration

These are the auth rows of the [configuration table](setup.md#configuration), with the same
meaning.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `API_KEY` | unset | The key that opens `/api` for a client. `bun run setApiKey` writes it. With neither `API_KEY` nor `AUTH_MODE`, the service refuses to start. | `src/http/server.ts`, `src/auth/access.ts`, `src/auth/set-api-key.ts` |
| `AUTH_MODE` | unset, no sign-in | `password` or `oidc`, one at a time. Any other value stops the start. | `src/auth/config.ts`, `src/auth/set-password.ts` |
| `AUTH_PASSWORD_HASH` | unset | The scrypt hash of the one password, for `AUTH_MODE=password`. `bun run set-password` writes it. A plain password is refused. | `src/auth/config.ts`, `src/auth/reset-credentials.ts` |
| `AUTH_COOKIE_SECURE` | unset, `false` | `true` marks the session cookie `Secure`, for a service behind an HTTPS proxy. | `src/auth/cookies.ts` |
| `OIDC_ISSUER` | unset, required for `oidc` | The issuer URL of the OpenID Connect provider. | `src/auth/config.ts` |
| `OIDC_CLIENT_ID` | unset, required for `oidc` | The client id registered at the provider. | `src/auth/config.ts` |
| `OIDC_CLIENT_SECRET` | unset | The client secret. Leave it unset for a public client, which proves itself with PKCE alone. | `src/auth/config.ts` |
| `OIDC_REDIRECT_URI` | unset, required for `oidc` | The callback URL registered at the provider, such as `http://localhost:3000/auth/oidc/callback`. | `src/auth/config.ts` |
| `OIDC_ALLOWED_SUBJECT` | unset | The one subject allowed in. Set this or `OIDC_ALLOWED_EMAIL`, or the start is refused. | `src/auth/config.ts` |
| `OIDC_ALLOWED_EMAIL` | unset | The one email allowed in, matched only when the provider marks it verified. | `src/auth/config.ts` |
| `OIDC_SCOPES` | `openid email` | Space-separated scopes. `openid` is added when it is missing. | `src/auth/config.ts` |

The commands that set and reset credentials are in the [commands table](setup.md#commands):
`set-password`, `setApiKey` and `reset-credentials`.

## Check it works

```sh
curl -si localhost:3000/auth/session
```

With the service running, this prints the response headers, including `x-request-id`, and then
`{"success":true,"data":{"mode":"password","signedIn":false}}`, with the mode that `AUTH_MODE`
names (`none` when it is unset) and `signedIn` false for a browser that has not signed in.

## Turn it off

Turning sign-in off means mode `none`. The API key stays a way in whatever the mode is.

1. In `.env`, remove the `AUTH_MODE` line, or leave it blank. Check that `API_KEY` is set: with no
   mode and no key, the next start refuses.
2. Restart the service with `bun run serve`.

`AUTH_PASSWORD_HASH` and the OIDC settings may stay in `.env`; they are read only in their own
mode. To sign every browser out and delete every API token as well, run `bun run reset-credentials`
before you turn sign-in off.

## Troubleshooting

Each message is quoted as the code prints it. The first two are startup refusals, and the start
stops with them.

An `AUTH_MODE` the code does not know:

```text
AUTH_MODE must be `password` or `oidc` (or unset for no login); it is "ldap".
```

Set it to one of the three values, or remove the line.

Neither `API_KEY` nor `AUTH_MODE` is set:

```text
Neither API_KEY nor AUTH_MODE is set, so nothing could open /api and the service will not start.
```

Run `bun run setApiKey --burn-after-reading`, or set `AUTH_MODE`. The full message also names both
fixes.

Password mode without a hash, which is what `bun run reset-credentials` leaves behind:

```text
AUTH_MODE=password needs AUTH_PASSWORD_HASH in .env. Run `bun run set-password` to write it.
```

Run `bun run set-password`. A value that is a plain password is refused with this message:

```text
AUTH_PASSWORD_HASH is not a hash `bun run set-password` wrote (a plain password is not accepted).
```

Clear the line and run `bun run set-password`. Never put the password itself in `.env`.

OIDC without a required setting, which names the setting it lacks:

```text
AUTH_MODE=oidc needs OIDC_CLIENT_ID in .env.
```

Set that variable. `OIDC_ISSUER`, `OIDC_REDIRECT_URI` and `OIDC_CLIENT_ID` are all required. A
start with neither `OIDC_ALLOWED_SUBJECT` nor `OIDC_ALLOWED_EMAIL` stops with
`AUTH_MODE=oidc needs OIDC_ALLOWED_SUBJECT or OIDC_ALLOWED_EMAIL, so only one person can sign in.`

A URL that is not an absolute `http(s)` URL stops the start with `OIDC_ISSUER must be an absolute
http(s) URL.`, or the same message for `OIDC_REDIRECT_URI`.

Refused at the provider, the browser lands on `/login?error=oidc`, and the log line
`OIDC sign-in refused` carries a `reason`. The reasons name the step: a discovery document that
names another issuer, a token endpoint that answered an error, an `id_token` that did not verify,
a nonce or state that does not match, or an `id_token` that names someone else. A callback with no
pending attempt in this browser, such as one reloaded after its first use, gives the reason
`no sign-in attempt is pending in this browser`. Start again from `/login`.

On `/auth` the browser sees these messages:

- `403` with `this request must send the x-app-csrf header`: a write on `/auth` without the header.
- `401` with `wrong password`: the password did not match.
- `429` with `too many wrong passwords; try again in N seconds`, and a `Retry-After` header. Five
  wrong passwords pause sign-in for 60 seconds. The count is kept in memory, so a restart resets
  it.
- `401` with `sign in first`: a token route was called without a session.
- `404` with `no such auth route for this AUTH_MODE`: the route belongs to another mode. Only
  `/auth/login` is mounted in password mode, the OIDC routes in oidc mode, and the token routes in
  password and oidc modes.

On `/api` the browser sees `401` with `a valid API key, API token or sign-in is required` for any
refused credential, and a `403` with `a signed-in browser write must send the x-app-csrf header` for
a cookie write without the header. A `503` with `the service is not configured to accept requests`
means `API_KEY` is unset, and the server log says `API_KEY is not set; refusing every request`.

A `reset-credentials` run that cannot reach the database says so, with the driver's code:

```text
Could not clear sessions and tokens (CODE). Is the database running? Try `bun run db:up`.
```

Start the database, as [the database page](database.md) describes, and run the command again.

When the password is lost, `bun run reset-credentials` signs every browser out, deletes every API
token and removes `AUTH_PASSWORD_HASH`. It leaves `API_KEY` and the OIDC settings alone, and its
output says what to run next. Every API token it deletes is gone, so any client that used one
needs a new token.

Tokens still work in mode `none`. The check on `/api` reads the token table in every mode, so a
token minted under password or oidc keeps opening `/api` after `AUTH_MODE` is unset, until it is
revoked or `reset-credentials` deletes it.
