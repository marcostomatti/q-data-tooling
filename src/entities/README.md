# Entities

An entity is a domain object: one thing the service stores or passes around, as a
zod schema plus its inferred type. It holds no behaviour beyond a pure helper such as `toCik10`, and
knows nothing of HTTP, MCP or the database.

An entity may import only `zod` and other entities.

The entities that ship are `company.ts` (`Company`, `CompanyTicker`, `toCik10`) and `filing.ts`
(`Filing`, `FilingLinks`, `TrackedForm`). Each names its schema and its inferred type alike, so
`Company` is both.

Sketch of a note entity, `src/entities/<name>.ts` with `note` as the name:

```ts
import { z } from 'zod';
export const NoteSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;
```
