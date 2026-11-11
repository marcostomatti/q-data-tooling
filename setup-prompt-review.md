# Setup prompt review

Review @setup-prompt.md, adapt the survey snippets in it to the new requirements, and prepare
the work.

## Order of work

Backend

1. Endpoints with their schemas.
2. DB tables, schemas and seed, from the company tickers JSON.
3. Fetching filings from SEC.
4. Validate the responses and the link templates.

Frontend

5. Companies page, from the companies in the DB.
6. Filings modal / drawer screens.
7. Summary component.

## Notes

- No visual tests.
- User password: set once in the terminal. Check whether the DB is created automatically.
- Do not change `NOTES.md`.
- API docs (OpenAPI) come from the latest `open-tomato/template-service`. Add no docs packages or
  tooling of our own.

## Deliver

1. Snippets and instructions to update `setup-prompt.md`.
2. A detailed spec for `rafa plan create`, run on the side, not in this session.
3. This prompt and the previous one as two clean, minimal files: `schema survey review.md` and
   `setup-prompt-review.md`.
4. README with the steps to set up and run the project, password included.
5. Copies of the spec and the plan in `docs/specs/` and `docs/plan/`.

## Before any commit

Check that nothing private or secret is exposed: device names, user names other than GitHub
ones, `.env`, secrets.
