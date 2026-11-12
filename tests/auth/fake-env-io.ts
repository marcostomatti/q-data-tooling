/**
 * An in-memory `.env` and terminal for the credential scripts' `main`, shared by
 * `tests/auth/credential-scripts.test.ts` and `tests/integration/auth/credential-scripts.test.ts`.
 * No real file is read or written.
 *
 * @module
 */

/** Where the fake `.env` lives; nothing is ever written there. */
export const FAKE_ENV_PATH = '/fake/.env';

/** The side effects the scripts take, recorded in memory. */
export interface FakeEnvIo {
  /** Every file written, by path; the `.env` is at {@link FAKE_ENV_PATH}. */
  readonly files: Map<string, string>
  /** What the script wrote to stdout, one entry per write. */
  readonly out: string[]
  /** What the script wrote to stderr, one entry per write. */
  readonly err: string[]
  /** The functions to hand the script's `main`. */
  readonly io: {
    readonly envPath: string
    readFile(path: string): Promise<string | null>
    writeFile(path: string, text: string): Promise<void>
    askSecret(): Promise<string>
    write(text: string): void
    writeError(text: string): void
  }
}

/**
 * An in-memory `.env` and terminal.
 *
 * @param initial - The `.env` text, or `null` for no `.env` at all.
 * @param answers - What the terminal answers to each secret prompt, in order; `''` once they run out.
 * @returns The fake, with what the script wrote readable on it.
 */
export function fakeEnvIo(initial: string | null, answers: string[] = []): FakeEnvIo {
  const files = new Map<string, string>();
  if (initial !== null) files.set(FAKE_ENV_PATH, initial);
  const out: string[] = [];
  const err: string[] = [];
  const pending = [...answers];
  return {
    files,
    out,
    err,
    io: {
      envPath: FAKE_ENV_PATH,
      readFile: async (path: string) => files.get(path) ?? null,
      writeFile: async (path: string, text: string) => void files.set(path, text),
      askSecret: async () => pending.shift() ?? '',
      write: (text: string) => void out.push(text),
      writeError: (text: string) => void err.push(text),
    },
  };
}
