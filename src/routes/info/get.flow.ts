import type { InfoInput, ServiceInfo } from './contract.ts';
import type { Log } from '../../logging.ts';

import packageJson from '../../../package.json' with { type: 'json' };
import { APP } from '../../app-config.ts';
import { scoped } from '../../logging.ts';
import { readNotebookConfig } from '../../notebook/config.ts';

/**
 * What `getServiceInfo` reads: the environment and the active database dialect, and nothing
 * else, and the log it writes to, which its transport has bound to the `Info` domain.
 */
export interface ServiceInfoDeps {
  readonly env: Record<string, string | undefined>
  readonly dialect: 'sqlite' | 'pg'
  readonly log: Log
}

/**
 * What the service is and how it runs. `notebook` says whether `OPEN_NOTEBOOK_URL` names a
 * usable notebook address, not whether that notebook answers: the probe runs only at MCP startup.
 * `deps.env` is read on each call, so a test can pass its own and the answer follows it.
 *
 * Its scope is `get`, and its one crumb is a `debug` line with step `read`: answering a read of
 * static facts is not a step on a critical path, so nothing here reaches `info`.
 */
export function getServiceInfo(_input: InfoInput, deps: ServiceInfoDeps): ServiceInfo {
  const log = scoped(deps.log, 'get');
  const notebook = readNotebookConfig(deps.env).kind === 'on';
  log.debug({ step: 'read', dialect: deps.dialect, notebook }, 'service info read');
  return {
    id: APP.id,
    name: APP.name,
    version: packageJson.version,
    dialect: deps.dialect,
    notebook,
  };
}
