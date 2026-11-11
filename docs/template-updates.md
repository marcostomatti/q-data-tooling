# Template updates

A project made from this template keeps its own history, and the template keeps changing after
the project starts: package updates, fixes, new skills. These steps bring the template's latest
`main` into the project's working branch. Resolving a conflict between the two is the project's
own call, and these steps do not cover it.

## Bring the template in

1. Add the template as a second remote, once per clone:

   ```sh
   git remote add template https://github.com/open-tomato/template-service.git
   ```

2. Fetch its latest `main`:

   ```sh
   git fetch template
   ```

3. Switch to the working branch, with no uncommitted changes, and merge the template's `main`
   into it:

   ```sh
   git merge template/main
   ```

   A project made with GitHub's "Use this template" starts from a fresh first commit, so its
   history shares no commit with the template's. Git refuses the first merge of such a project
   with `refusing to merge unrelated histories`, and that first merge needs the flag that allows
   it:

   ```sh
   git merge --allow-unrelated-histories template/main
   ```

   Every later merge finds the previous one as their common commit and needs no flag.

## Check the result

1. Install what the template's `package.json` and `bun.lock` now name: `bun install`.
2. Apply any migration the template added: `bun run db:migrate`.
3. Run the gates, in the order `CLAUDE.md` lists them.
4. Read what changed in `CLAUDE.md` and under `.claude/skills/`, because they tell the agent how
   to work in the project.

To see what the template changed before merging it, compare the working branch with it:

```sh
git log --oneline HEAD..template/main
```
