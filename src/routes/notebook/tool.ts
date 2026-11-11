import type { NotebookClient } from '../../notebook/client.ts';
import type { ZodType } from 'zod';

import { inDomain } from '../../logging.ts';
import { defineTool, type ToolDefinition, type ToolSpec } from '../../mcp/register.ts';

import {
  DOMAIN,
  NoteAddSchema,
  NotebookCreateSchema,
  NotebookListSchema,
  SearchSchema,
  SourceAddTextSchema,
  SourceGetSchema,
  SourceListSchema,
  SourceRefSchema,
} from './contract.ts';

/** What the notebook tools need: the client that talks to Open Notebook. */
export interface NotebookToolDeps {
  readonly client: NotebookClient
}

/** Every notebook tool name, in registration order, so a test can pin the set. */
export const NOTEBOOK_TOOL_NAMES = [
  'notebook_list',
  'notebook_create',
  'notebook_source_list',
  'notebook_source_get',
  'notebook_source_add_text',
  'notebook_source_delete',
  'notebook_search',
  'notebook_note_add',
] as const;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/**
 * `defineTool`, with the `Notebook` domain bound on the log the tool's `run` is handed. There is
 * no flow and no `http.ts` here, so this file is the one place the domain is bound.
 */
function notebookTool<S extends ZodType>(spec: ToolSpec<S>): ToolDefinition {
  return defineTool({ ...spec, run: async (args, context) => spec.run(args, { ...context, log: inDomain(context.log, DOMAIN) }) });
}
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/**
 * The Open Notebook tools. They exist only when a notebook is configured and answered at
 * startup (`server.ts` decides), and they may be the only way to reach a notebook run as a
 * container with no UI, so they cover the whole loop: notebooks, sources, search and notes.
 * None of them reads or writes the service's own database.
 */
export function notebookTools(deps: NotebookToolDeps): ToolDefinition[] {
  const { client } = deps;
  return [
    notebookTool({
      name: 'notebook_list',
      title: 'List notebooks',
      description:
        'Lists the notebooks in Open Notebook with their id, name, description and how many sources and notes each holds. ' +
        'Archived notebooks are left out unless includeArchived is true. A notebook id (notebook:…) is what the other notebook tools take.',
      input: NotebookListSchema,
      annotations: READ_ONLY,
      run: async (args) => client.listNotebooks({ archived: args.includeArchived === true
        ? undefined
        : false }),
    }),
    notebookTool({
      name: 'notebook_create',
      title: 'Create a notebook',
      description:
        'Creates a notebook and returns it with its id. A useful layout is one notebook per employer you are serious about, ' +
        'named as this service stores the company, plus one for your own background (CV, past-work notes). ' +
        'Call notebook_list first: two notebooks may share a name, and this does not check.',
      input: NotebookCreateSchema,
      annotations: WRITES,
      run: async (args) => client.createNotebook({ name: args.name, description: args.description }),
    }),
    notebookTool({
      name: 'notebook_source_list',
      title: 'List notebook sources',
      description:
        'Lists sources (stored documents), newest first, without their text: id, title, whether they are embedded for meaning search, and processing status. ' +
        'Give notebookId to list one notebook; leave it out for all. Pages of up to 100; use offset for the next page. ' +
        'Use notebook_source_get to read a source.',
      input: SourceListSchema,
      annotations: READ_ONLY,
      run: async (args) => client.listSources(args),
    }),
    notebookTool({
      name: 'notebook_source_get',
      title: 'Read a notebook source',
      description:
        'Returns ONE source with its text, for example a CV or past-work notes you need before drafting or answering a question. ' +
        'The text comes in a window: maxChars from offset (default 20000 from 0). truncated is true when more follows; ' +
        'call again with offset set to textOffset plus the length you got. An unknown id is a not-found error.',
      input: SourceGetSchema,
      annotations: READ_ONLY,
      run: async (args) => {
        const { fullText, ...source } = await client.getSource(args.sourceId);
        const full = fullText ?? '';
        const text = full.slice(args.offset, args.offset + args.maxChars);
        return { ...source, text, textOffset: args.offset, totalChars: full.length, truncated: args.offset + text.length < full.length };
      },
    }),
    notebookTool({
      name: 'notebook_source_add_text',
      title: 'Store text in a notebook',
      description:
        'Stores pasted text as a source in one or more notebooks, embedded for meaning search unless embed is false. ' +
        'Processing runs in the background: the returned status is not final, and search finds the text a little later. ' +
        'Sources are copies; to change one, store the new text and delete the old source.',
      input: SourceAddTextSchema,
      annotations: WRITES,
      run: async (args) => {
        const { fullText: _text, ...source } = await client.addTextSource(args);
        return source;
      },
    }),
    notebookTool({
      name: 'notebook_source_delete',
      title: 'Delete a notebook source',
      description:
        'Deletes ONE source from Open Notebook, from every notebook it is in. This cannot be undone. ' +
        'Use it to remove an older copy after storing a new one, so a search cannot answer from the version you replaced. ' +
        'Confirm with the user before deleting anything they did not ask to replace.',
      input: SourceRefSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      run: async (args) => {
        await client.deleteSource(args.sourceId);
        return { deleted: args.sourceId };
      },
    }),
    notebookTool({
      name: 'notebook_search',
      title: 'Search the notebook',
      description:
        'Searches sources and notes. type text matches words; type vector matches meaning and needs an embedding model set up in Open Notebook. ' +
        'Give notebookId to search one notebook; an Open Notebook older than scoped search ignores it and searches all of them, so check each hit\'s source if the scope matters. ' +
        'Results are passed on as Open Notebook returns them, with their ids, ' +
        'so a hit can be read in full with notebook_source_get.',
      input: SearchSchema,
      annotations: READ_ONLY,
      run: async (args) => client.search(args),
    }),
    notebookTool({
      name: 'notebook_note_add',
      title: 'Add a note to a notebook',
      description:
        'Adds a note in the user\'s words to ONE notebook: something they told you about past work, what they want or avoid, ' +
        'or meeting notes. Notes are searched with sources. Write down what the user said, not your reading of it.',
      input: NoteAddSchema,
      annotations: WRITES,
      run: async (args) => client.addNote(args),
    }),
  ];
}

