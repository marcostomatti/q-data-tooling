import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { rebuildQueue, shouldRebuild, WEB_DIST } from '../../scripts/dev.ts';

/** Waits long enough for a queue with a 5 ms delay to start and finish its builds. */
async function settleQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('shouldRebuild', () => {
  test('a change to the app, an entity or the server rebuilds the web app', () => {
    expect(shouldRebuild(join('web', 'pages', 'filings', 'view.tsx'))).toBe(true);
    expect(shouldRebuild(join('entities', 'filing.ts'))).toBe(true);
    expect(shouldRebuild(join('http', 'server.ts'))).toBe(true);
  });

  test('the build writing its own folder does not, so a build never sets off the next', () => {
    expect(shouldRebuild(WEB_DIST)).toBe(false);
    expect(shouldRebuild(join(WEB_DIST, 'index.html'))).toBe(false);
    expect(shouldRebuild(join(WEB_DIST, 'chunk-abc123.js'))).toBe(false);
  });

  test('a folder whose name only starts like the build\'s is still watched', () => {
    expect(shouldRebuild(join('web', 'distance.ts'))).toBe(true);
  });

  test('a change the watcher cannot name rebuilds, to be safe', () => {
    expect(shouldRebuild(null)).toBe(true);
  });
});

describe('rebuildQueue', () => {
  test('a burst of changes builds once, after the burst', async () => {
    // Arrange
    let builds = 0;
    const changed = rebuildQueue(async () => {
      builds += 1;
    }, 5);

    // Act
    changed();
    changed();
    changed();
    await settleQueue();

    // Assert
    expect(builds).toBe(1);
  });

  test('a change during a build asks for one more build after it, never two at once', async () => {
    let builds = 0;
    let running = 0;
    let overlapped = false;
    let changed: () => void = () => {};
    changed = rebuildQueue(async () => {
      running += 1;
      overlapped ||= running > 1;
      builds += 1;
      if (builds === 1) {
        changed();
        changed();
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      running -= 1;
    }, 5);

    changed();
    await settleQueue();

    expect(builds).toBe(2);
    expect(overlapped).toBe(false);
  });

  test('a build that crashes is reported, and the next change builds again', async () => {
    let builds = 0;
    const crashes: unknown[] = [];
    const changed = rebuildQueue(async () => {
      builds += 1;
      if (builds === 1) throw new Error('build crashed');
    }, 5, (failure) => crashes.push(failure));

    changed();
    await settleQueue();
    changed();
    await settleQueue();

    expect(builds).toBe(2);
    expect(crashes).toHaveLength(1);
    expect((crashes[0] as Error).message).toBe('build crashed');
  });
});
