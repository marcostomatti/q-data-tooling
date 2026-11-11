# /fe empty-page <name>

Creates one page in the signed-in app: its view, its nav entry, its server path and its test. The
reference is `src/web/pages/home.tsx`. Its `h1` sits in a `Content` row, and an `EmptyState` sits
under it, because the library has no page-header component.

## Ask first

Settle these four before you write anything, one question each. Do not ask again for an answer the
call already carries, such as the name in `/fe empty-page reports`:

1. **Name.** The file stem, such as `reports`. The page file is `src/web/pages/<name>.tsx`, and
   its URL is `/<name>`.
2. **Label.** The nav entry's text and the topbar heading, such as `Reports`.
3. **Icon.** A Lucide name from the library's `IconName`, which `src/web/app.tsx` imports from
   the component library. The existing entries use `house` and `key-round`.
4. **Go ahead.** Summarise the files you will write, then ask for a yes before you write them.

## Files to write

**Page:** `src/web/pages/<name>.tsx`. Export a pure `<Name>View` and a `<Name>Page` that returns
it. An empty page fetches nothing, so the page takes no props. The example is `HomeView` and
`HomePage` in `src/web/pages/home.tsx`:

```tsx
// src/web/pages/home.tsx
export function HomeView({ title = APP.landing.label }: HomeViewProps) {
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{title}</h1>
      </Content>
      <EmptyState title={HOME_EMPTY_TITLE} description={HOME_EMPTY_DESCRIPTION} />
    </Content>
  )
}
```

`HomeView` takes a `title` prop only because the landing label lives in `APP.landing`. The new view
takes no props: put its heading, the label, in a `<NAME>_TITLE` constant. Give the empty state its
own `<NAME>_EMPTY_TITLE` and `<NAME>_EMPTY_DESCRIPTION` constants, as `HOME_EMPTY_TITLE` and
`HOME_EMPTY_DESCRIPTION` are in that file, so a test can name all three.

**Nav:** `PAGES` in `src/web/app.tsx`. Import `<Name>Page` beside the other page imports, then add
an entry after the landing entry, which must stay first. The declaration as it stands is:

```tsx
export const PAGES: readonly AppPage[] = [
  { path: APP.landing.path, label: APP.landing.label, icon: 'house', render: () => <HomePage /> },
  { path: '/companies', label: 'Companies', icon: 'building-2', render: () => <CompaniesPage /> },
  { path: '/tokens', label: 'Tokens', icon: 'key-round', render: () => <TokensPage /> },
];
```

The new entry is one line like the `/tokens` one, with its own path, label, icon and
`<Name>Page`, and it goes after the landing line and before the closing `];`.

**Server path:** `APP_PATHS` in `src/http/server.ts`, which today is
`['/', '/login', APP.landing.path, '/companies', '/tokens']`. Add `'/<name>'`, so a reload on the new page is
served the app and not a 404.

**Pinned lists:** three tests pin these lists exactly, and each fails until you update it in the
same change. Where a test's title names the old list, retitle it to match.

- `APP_PATHS` in `tests/http/server.test.ts`: add the same `'/<name>'` to its `toEqual`.
- `PAGES` in `tests/web/pages.test.tsx`, in two tests. The first test of the `the page table`
  block holds `toEqual([APP.landing.path, '/companies', '/tokens'])`, and the first of `the pages together`
  holds the same `toEqual` plus `toHaveLength(3)`. Add `'/<name>'` where it sits in `PAGES`, so
  after the landing path, and raise the length by one.

**Test:** `tests/web/<name>.test.tsx`. Render `<Name>View` with `renderToStaticMarkup` from
react-dom/server, assert its title and empty-state text, and assert `pageFor('/<name>').path` is
`'/<name>'`, so the nav finds the path. Check the path, not that an entry came back: `pageFor`
returns the landing page for any path `PAGES` does not hold, so that check passes with no entry at
all.

## Logging

The web app does not log to the server logger. The page imports nothing from `src/logging.ts`, so
it binds no domain or scope and writes no log line, and its test needs no capturing log.

## Documentation

The page's exported view and its entry each get a TSDoc block, `/** ... */` before them, saying
what the page shows. `docs/documentation.md` holds the rules, and `bun run docs:typedoc` renders
them.

## Verify

Run `bun run typecheck && bun run lint && bun test tests/web tests/http/server.test.ts`. All of
them must pass before the page is done.
