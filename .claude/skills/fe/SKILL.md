---
name: fe
description: Use when adding a page to the web app, a new page or screen in the signed-in frame, or
  an empty page to fill in later. Trigger words include "add a page", "new page", "empty page" and
  "new screen". Only `empty-page` is built; the list, CRUD, modal, form and wizard pages are not.
---

# /fe

The router for web pages in this template. It has one action built, `empty-page`. Read only the
action file you were called with.

| Call | Read |
| --- | --- |
| `/fe empty-page <name>` | `.claude/skills/fe/actions/empty-page.md` |

## Not built

These actions are planned and NOT built. No file exists for any of them, and `/fe <action>` with
one of these names does nothing. Do not invent their files. If asked for one, say it is not built,
and offer `empty-page` plus hand composition from the library's stories:

- `list-page`: a list of rows, from `Table` and `Toolbar` in the component library.
- `crud-page`: a list with create and edit, from `Table` and `FormKit`.
- `modal-view`: a view opened in a `Modal`.
- `form-flow`: a form that saves, from `FormKit`.
- `wizard-flow`: a multi-step flow in a `Drawer`.

## Where the pieces live

- Page: `src/web/pages/<name>.tsx` holds an `XPage` and a pure `XView`, as `src/web/README.md`
  describes. `src/web/pages/home.tsx` is the empty-page example.
- Nav: `PAGES` in `src/web/app.tsx` lists every page the signed-in app shows, in nav order.
- Server path: `APP_PATHS` in `src/http/server.ts` lists the paths the server hands the app to,
  so a reload on a deep link is served.
- Test: `tests/web/<name>.test.tsx` renders the view, as `tests/web/pages.test.tsx` does.

The library has no page-header component, so the header is an `h1` in a `Content` row, as
`src/web/pages/home.tsx` shows.
