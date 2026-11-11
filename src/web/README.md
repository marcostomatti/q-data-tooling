# Web app

The signed-in app is React 19, built by `bun run build:web` into `src/web/dist`.
It draws controls from `@open-tomato/components` and styles them with Tailwind 4.

## Page structure

Each page is a pair:

- `XPage` owns fetching and state. Its server access is a prop, defaulting to
  the real client, so a test can inject a fake.
- `XView` is pure. It takes props and renders. Tests render it with
  `renderToStaticMarkup` from `react-dom/server`, with no DOM.

A page that is only the pair is one file, `src/web/pages/<name>.tsx`, as
`tokens.tsx` is. A page with more parts is a folder, `src/web/pages/<name>/`,
one file per part, as `companies/` and `summary/` are:

- `index.tsx` holds `XPage`, the only file `src/web/app.tsx` imports.
- `view.tsx` holds `XView`, which composes the parts.
- one `.tsx` per part of the view, such as `toolbar.tsx`, `row.tsx`,
  `table.tsx` or `chart.tsx`.
- `logic.ts` holds the page's constants, its server-access interface and its
  pure functions, with no JSX.

A page draws no heading. The shell's `AppShellTitle` shows the page's nav
label as the screen's one `h1`. A failed call's message comes from `messageOf`
in `api.ts`, the one copy every page uses.

## Components

A piece that opens over a page rather than being one sits in
`src/web/components/<name>/`, split as a page folder is, with its test in
`tests/web/<name>.test.tsx`. `filings/` is the filings drawer and modal:
`view.tsx` holds the pure `FilingsView`, and `index.tsx` holds
`FilingsDialog`, which holds the state and the fetching. The library's
`Drawer` and `Modal` render nothing without a DOM, so the tests render the
pure `FilingsPanel` (`panel.tsx`) inside them and read which overlay the view
returns by calling it.
In the drawer the panel lists the filings in the library's `Accordion`, one
group per tracked form. A closed group renders no children, so a test that reads
a group's links opens it with `defaultOpen`.

## Adding a page to `PAGES`

1. Create `src/web/pages/<name>.tsx` with the `XPage` and `XView` pair.
2. Import it in `src/web/app.tsx` and add an entry to `PAGES`:

   ```tsx
   import { TokensPage } from './pages/tokens.tsx';

   export const PAGES: readonly AppPage[] = [
     // …the entries before it
     { path: '/tokens', label: 'Tokens', icon: 'key-round', render: () => <TokensPage /> },
   ];
   ```

`path` is the URL, `label` is the nav entry and topbar heading, and `icon` is a
Lucide name from the library's `IconName`. The first entry is the landing page,
where `/` lands. Its `path` and `label` read `APP.landing` in `src/app-config.ts`,
so rename the landing page there.

## Where the library's stories live

The stories are in the library's own checkout, `~/projects/open-tomato/components/packages/ui`,
not in this repo.

- The `AppShell` and `AuthShell` stories in its templates folder are the composed examples
  the signed-in frame and sign-in frame follow.
- The sessions story in its stories folder is a list example.
- Its organisms, molecules and atoms folders hold the components.

Read a story first. Pass variants and flags only, never a class string.

## The Tailwind entry

`src/web/styles.css` is the one stylesheet the app writes:

```css
@import "tailwindcss";
@import "@open-tomato/components/styles.css";
@source "../../node_modules/@open-tomato/charts/dist";
```

The components library's `@source` points Tailwind's scan at that library, and
the line after it points the scan at `@open-tomato/charts`, which brings no
`@source` of its own. Below them a `@theme static` block defines every token
the charts read (`--color-series-1` and the rest), each one a `var()` over a
semantic variable of the components library, so a chart flips with
`data-theme` as the library does; `static` keeps a token in the build when no
class uses it, since the chart reads it from the computed style. The shell
fills the viewport through `AppShell`'s `viewport` flag, so no rule sizes
`html`, `body` or `#root`. Write no other hand-made CSS here; change the page's
composition first.

## The library version

`package.json` depends on `"@open-tomato/components": "0.2.0"`, the published
package. 0.2.0 is the first version that exports `AppShellBrand`,
`AppShellTitle` and `AppShellSpacer`, which the shell composes in place of
class strings. It takes React as a peer dependency, so the bundle and the tests use
this project's one copy of React. A local checkout of the library linked in
its place brings its own `node_modules/react`, and its hooks then fail with
"Invalid hook call"; `tests/web/build.test.ts` and
`tests/web/library-render.test.tsx` catch that.
