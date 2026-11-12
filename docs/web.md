# Web app

This page covers the signed-in web app: how `bun run build:web` builds it, how the service
serves it beside the API, the pages it has, and how to add one with `/fe empty-page`.
[Setup](setup.md) takes a clone to a running service first. The
[library page](../src/web/README.md) covers the component library and how a page is written.

## What it is and when to turn it on

The web app is a React 19 page that a person uses in a browser. It draws its controls from
`@open-tomato/components` and styles them with Tailwind 4. Its entry is `src/web/index.html`,
and `bun run build:web` compiles it into a folder that the service serves beside the API.

Turn it on when a person needs to sign in to the service or look at it in a browser. A service
that only a script or an agent calls does not need it: the API answers with no bundle at all.

Without a signed-in session, the app shows the sign-in page at `/login`. That page says sign-in
is off when `AUTH_MODE` is `none`, as [auth](auth.md) describes. With a session, it shows the
signed-in frame: a nav on the left, a topbar with the current page's label and a sign-out
button, and the page in the middle.

### The pages

The signed-in app has these pages, in nav order:

| Path | Nav label | Icon | Page |
| --- | --- | --- | --- |
| `/summary` | Summary | `chart-column-stacked` | `SummaryPage` in `src/web/pages/summary/`, the landing page |
| `/filings`, `/filings/<cik>` | Filings | `file-text` | `FilingsPage` in `src/web/pages/filings/`: one company's filings by its CIK, or an empty state with none |
| `/companies` | Companies | `building-2` | `CompaniesPage` in `src/web/pages/companies/` |
| `/tokens` | Tokens | `key-round` | `TokensPage` in `src/web/pages/tokens.tsx`, for API tokens |

`/summary` is the landing path in `APP.landing`. `/` lands there. A path the app does not list
also shows the landing page, and the address bar is moved to it. A path under a page's own path
is that page's: `/filings/320193` is the Filings page on Apple's filings, and the page reads the
CIK from the path, so the link can be shared or reloaded. The sign-in page is not in the
nav: it is what the app shows when nobody is signed in. A page draws no heading of its own: the
topbar's `AppShellTitle` shows its nav label as the screen's one `h1`.

The nav is built from `PAGES` in `src/web/app.tsx`, so that list is the one place a page is
added to the nav.

## Setup from zero

### Build the bundle

```sh
bun run build:web
```

The build writes `index.html` and two chunks, one `.js` and one `.css`, into `src/web/dist/`.
Git ignores that folder. The build prints the path of each file it wrote. `index.html` loads the
chunks from the root, as `/chunk-….js`, so a page under a path segment, such as
`/filings/320193`, loads them too. A chunk named relative to the page would be asked for as
`/filings/chunk-….js` there, which the server answers with `index.html`.

The default folder is emptied before every build, so a rebuild leaves no old chunks beside the
new ones. A folder named with `--outdir` is not emptied, since it belongs to the caller:

```sh
bun run build:web -- --outdir=<dir>
```

A build that fails prints each of its messages to stderr, then `build:web failed`, and exits 1.

### Serve it

`bun run serve` runs the build, then starts the service. The service looks for `src/web/dist/`
once, when it starts. When the folder is there, the service serves its files and answers each
path in `APP_PATHS` with `index.html`. Those paths are `/`, `/login`, the landing path, each
other page's path, and `/filings/:cik`. To see a change to the app, restart `bun run serve`, as
[the web build](setup.md#the-web-build) says, or run `bun run dev` instead: it rebuilds the app
on every change under `src/`, and a page reload shows it.

The app and the API share one origin, so the browser needs no CORS setup. A write from the app
sends the `x-app-csrf: 1` header, which [auth](auth.md#the-csrf-header) explains.

The server serves only `src/web/dist/`. A bundle built into any other folder is not served
unless it is passed as the `webDist` option of `startService`.

### Add a page with `/fe empty-page`

`/fe empty-page` is the one `/fe` action built. It creates a page that shows an empty state and
fetches nothing; the topbar shows its nav label as the heading. Call it with the page's name:

```text
/fe empty-page reports
```

The name is the file stem, so the page is `src/web/pages/<name>.tsx`, here with `reports` as the
name, and its URL is `/reports`. The skill then asks, one question at a time, for the nav label,
such as `Reports`, and for an icon, which is a Lucide name from the library's `IconName`. It
summarises the files it will write and writes nothing until you say yes. It creates:

- `src/web/pages/<name>.tsx`, with a pure `<Name>View` and a `<Name>Page` that renders it.
- A `PAGES` entry in `src/web/app.tsx`, after the landing entry, which stays first.
- `'/<name>'` in `APP_PATHS` in `src/http/server.ts`, so a reload on the page is served the app.
- `tests/web/<name>.test.tsx`, and the two pinned lists that test the same paths, in
  `tests/http/server.test.ts` and in `tests/web/pages.test.tsx`.

The new `PAGES` entry is one line after the landing entry, like this:

```tsx
// src/web/app.tsx
export const PAGES: readonly AppPage[] = [
  { path: APP.landing.path, label: APP.landing.label, icon: 'chart-column-stacked', render: () => <SummaryPage /> },
  { path: '/reports', label: 'Reports', icon: 'file-text', render: () => <ReportsPage /> },
  // …the entries after it
];
```

Then run the checks the skill names, and rebuild to see the page in the app:

```sh
bun run typecheck && bun run lint && bun test tests/web tests/http/server.test.ts
bun run build:web
```

Restart `bun run serve` after the build, then open `/reports` in the browser. The page
writes no server log line, because it imports nothing from the server's logger.

Only `empty-page` is built. The list, CRUD, modal, form and wizard pages are not, so for those,
compose the page by hand from the library's stories, as [the library page](../src/web/README.md)
lists them.

## Configuration

The web app reads no environment variable. Its settings are these constants and options:

| Setting | Default | What it does | Read by |
| --- | --- | --- | --- |
| `APP.name` | `SEC filings` | The name in the brand of the signed-in frame. | `src/app-config.ts`, read by `src/web/app.tsx` |
| `APP.landing` | `{ path: '/summary', label: 'Summary' }` | The landing page: where `/` lands, and the first nav entry. | `src/app-config.ts`, read by `src/web/app.tsx` and `src/http/server.ts` |
| `--outdir=<dir>` | `src/web/dist` | Where `bun run build:web` writes. Only the default folder is emptied before a build. | `scripts/build-web.ts` |
| `webDist` | `src/web/dist` | Where the service looks for the bundle at start. Set only in a test or a custom start. | `src/http/server.ts` |

Rename the landing page in `APP.landing`, not in the page file, so `/` and the nav follow it.

## Check it works

```sh
bun run build:web
```

It prints three absolute paths, the `index.html` and the two chunk files, and exits 0. Then
restart `bun run serve`, and the service answers the landing path with the app:

```sh
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/summary
```

It prints `200`. The same check works for `/tokens` and `/login`, which the server answers with
`index.html` as well.

## Turn it off

The web app has no switch. To stop serving it, remove its folder and restart the service:

```sh
rm -rf src/web/dist
bun run serve
```

The service then serves the API only, and logs `no web bundle found; serving the API only` at
start. The `/auth` and `/api` routes still answer, but a browser has no page to sign in on.

## Troubleshooting

Each message is quoted as the code prints it.

A build that logs `build:web failed` exited 1. The lines printed above it name the file that
failed, and a missing entry is a build error. Fix that file and run `bun run build:web` again.

A service that logs `no web bundle found; serving the API only` started before the build, or
without `src/web/dist/`. Run `bun run build:web`, then restart `bun run serve`.

A reload on a page's own path answers 404 while the page opens from the nav. The path is missing
from `APP_PATHS` in `src/http/server.ts`, so the server sends no `index.html` for it. Add the
path there and restart.

A page that renders `Invalid hook call` or a `null is not an object` error uses a second copy of
React. A linked checkout of the component library brings its own. The
[library version](../src/web/README.md#the-library-version) section says how the app pins the
published package.

A page that stays under `Loading…`, or shows a red line with an error, failed to reach the
session route. Check that `bun run serve` is running and that the browser uses its `PORT`.
