import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { APP } from '../../src/app-config.ts';
import { ApiError, request, type TokenSummary } from '../../src/web/api.ts';
import { pageFor, PAGES, Shell } from '../../src/web/app.tsx';
import { HOME_EMPTY_DESCRIPTION, HomePage, HomeView } from '../../src/web/pages/home.tsx';
import { LoginPage, LoginView } from '../../src/web/pages/login.tsx';
import { TOKENS_EMPTY_TITLE, TokensPage, TokensView } from '../../src/web/pages/tokens.tsx';

const noop = (): void => {};

/** The web app's stylesheet, as the build reads it. */
const STYLES = readFileSync(new URL('../../src/web/styles.css', import.meta.url), 'utf8');

function renderShell(path: string): string {
  return renderToStaticMarkup(
    <Shell current={pageFor(path)} onSignOut={noop} onNavigate={noop}>
      <p>page body</p>
    </Shell>,
  );
}

/** Each entry of the shell's main nav, by its label, and whether it is the current page. */
function navEntries(html: string): { label: string, current: boolean }[] {
  const nav = html.match(/<nav[^>]*aria-label="Main navigation"[^>]*>(.*?)<\/nav>/)?.[1] ?? '';
  return [...nav.matchAll(/<button([^>]*)>(?:(?!<\/button>).)*?<span[^>]*>([^<]+)<\/span><\/button>/g)].map(
    (match) => ({ label: match[2] ?? '', current: (match[1] ?? '').includes('aria-current="page"') }),
  );
}

describe('Shell', () => {
  test('marks only the current page, never another one', () => {
    const html = renderShell('/tokens');

    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(navEntries(html).filter((entry) => entry.current)
      .map((entry) => entry.label)).toEqual(['Tokens']);
  });

  test('carries no product name but the one from the app config', () => {
    const html = renderShell('/');

    expect(html).toContain(APP.name);
  });

  test('builds the nav from PAGES in order, and an unknown path marks the landing page', () => {
    const entries = navEntries(renderShell('/nowhere'));

    expect(entries.map((entry) => entry.label)).toEqual(PAGES.map((page) => page.label));
    expect(entries.find((entry) => entry.current)?.label).toBe(APP.landing.label);
  });

  test('shows the brand, the page label in the topbar, a sign-out action and the page', () => {
    const html = renderShell('/tokens');

    expect(html).toContain(`aria-label="${APP.name}"`);
    expect(html).toMatch(/<header[^>]*>.*<span[^>]*>Tokens<\/span>.*<\/header>/);
    expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
    expect(html).toContain('<p>page body</p>');
  });
});

/** The class list of the first element the pattern's group captures, split into names. */
function classesOf(html: string, pattern: RegExp): string[] {
  return (html.match(pattern)?.[1] ?? '').split(' ');
}

describe('Shell layout', () => {
  test('sizes html, body and #root to the viewport, since AppShell only fills the box its parent gives it', () => {
    const rule = STYLES.match(/[^{}]*\{[^}]*\}/g)?.find((block) => block.includes('#root')) ?? '';

    expect(rule).toMatch(/\bhtml\b/);
    expect(rule).toMatch(/\bbody\b/);
    expect(rule).toMatch(/height:\s*100%/);
  });

  test('puts the brand in a row as tall as the topbar, so their dividers line up', () => {
    const html = renderShell('/');
    const brandRow = classesOf(html, /<aside[^>]*><div class="([^"]*)"/);
    const topbar = classesOf(html, /<header class="([^"]*)"/);

    for (const name of ['h-[60px]', 'border-b']) {
      expect(brandRow).toContain(name);
      expect(topbar).toContain(name);
    }
  });

  test('pushes the sign-out action to the far end of the topbar', () => {
    expect(renderShell('/')).toMatch(/<div class="flex-1"><\/div><button[^>]*>Sign out<\/button>/);
  });
});

describe('LoginPage', () => {
  test('with no mode it says sign-in is off and shows no form, no password field and no provider button', () => {
    const html = renderToStaticMarkup(<LoginView mode="none" />);

    expect(html).toContain('No login is configured');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('/auth/oidc/start');
  });

  test('oidc mode shows no alert unless the callback refused, and no password form', () => {
    const plain = renderToStaticMarkup(<LoginView mode="oidc" />);
    const refused = renderToStaticMarkup(<LoginView mode="oidc" oidcError />);

    expect(plain).not.toContain('role="alert"');
    expect(plain).not.toContain('<form');
    expect(refused).toMatch(/role="alert"[^>]*>.*That sign-in was refused/);
  });

  test('oidc mode links its button to the start route', () => {
    const html = renderToStaticMarkup(<LoginView mode="oidc" />);

    expect(html).toMatch(/<a[^>]*href="\/auth\/oidc\/start"[^>]*>Continue to your provider<\/a>/);
  });

  test('the provider link wears the same primary full-width look as the sign-in button', () => {
    const classOf = (html: string, tag: string): string | undefined => new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(html)?.[1];
    const link = classOf(renderToStaticMarkup(<LoginView mode="oidc" />), 'a');
    const button = classOf(renderToStaticMarkup(<LoginView mode="password" />), 'button');

    expect(link).toBeDefined();
    expect(link).toBe(button);
  });

  test('password mode with nothing typed shows no alert and a disabled sign-in button', () => {
    const html = renderToStaticMarkup(<LoginView mode="password" />);

    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign in<\/button>/);
  });

  test('password mode shows a labelled password field and points at reset-credentials', () => {
    const html = renderToStaticMarkup(<LoginView mode="password" password="hunter2" />);

    expect(html).toContain('<form');
    expect(html).toMatch(/<label[^>]*for="login-password"/);
    expect(html).toMatch(/<input(?=[^>]*\stype="password")[^>]*\sid="login-password"/);
    expect(html).toContain('<code>bun run reset-credentials</code>');
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  test('password mode shows a failed sign-in as an alert, and a busy one as signing in', () => {
    const failed = renderToStaticMarkup(<LoginView mode="password" password="x" error="wrong password" />);
    const busy = renderToStaticMarkup(<LoginView mode="password" password="x" busy />);

    expect(failed).toMatch(/role="alert"[^>]*>.*wrong password/);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>Signing in…<\/button>/);
  });

  test('carries no product name but the one from the app config', () => {
    for (const mode of ['none', 'password', 'oidc'] as const) {
      const html = renderToStaticMarkup(<LoginView mode={mode} oidcError />);

      expect(html).toContain(APP.name);
    }
  });

  test('the page renders the view for its mode, with an empty password form', () => {
    const html = renderToStaticMarkup(<LoginPage mode="password" onSignedIn={noop} login={async () => {}} />);

    expect(html).toEqual(renderToStaticMarkup(<LoginView mode="password" />));
  });
});

/** A live token and a revoked one, each by its summary: name, first characters and dates. */
const LISTED: TokenSummary[] = [
  { id: 1, name: 'research agent', prefix: 'tok_abcd', createdAt: '2026-01-02T10:00:00Z', lastUsedAt: '2026-01-04T10:00:00Z', revokedAt: null },
  { id: 2, name: 'old laptop', prefix: 'tok_wxyz', createdAt: '2026-01-01T10:00:00Z', lastUsedAt: null, revokedAt: '2026-01-03T10:00:00Z' },
];

/** A whole token whose first characters are the first listed summary's prefix. */
const WHOLE_TOKEN = 'tok_abcd9f8e7d6c5b4a3f2e1d0c9b8a7f6e';

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The markup of the token table alone, from its frame to the end of the page. */
function tablePart(html: string): string {
  const at = html.indexOf('<table');
  return at === -1
    ? ''
    : html.slice(at);
}

describe('TokensView', () => {
  test('with no tokens it shows the empty state and no table, Revoke or fresh token', () => {
    const html = renderToStaticMarkup(<TokensView tokens={[]} />);

    expect(html).toContain(TOKENS_EMPTY_TITLE);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('>Revoke<');
    expect(html).not.toContain('Copy this token now');
    expect(html).not.toContain('role="alert"');
  });

  test('the mint form with no name typed has a disabled create button', () => {
    const blank = renderToStaticMarkup(<TokensView tokens={[]} name="   " />);
    const named = renderToStaticMarkup(<TokensView tokens={[]} name="ci runner" />);

    expect(blank).toMatch(/<button[^>]*disabled=""[^>]*>Create token<\/button>/);
    expect(named).toMatch(/<form.*<label[^>]*for="token-name"/);
    expect(named).not.toMatch(/<button[^>]*disabled=""[^>]*>Create token<\/button>/);
    expect(named).toMatch(/<button[^>]*>Create token<\/button>/);
  });

  test('a revoked token carries the revoked badge and no Revoke button', () => {
    const html = renderToStaticMarkup(<TokensView tokens={LISTED} />);

    expect(occurrences(html, '>revoked</span>')).toBe(1);
    expect(occurrences(html, '>Revoke</button>')).toBe(1);
    expect(html).toMatch(/old laptop.*>revoked<\/span>/);
    expect(html).not.toMatch(/old laptop.*>Revoke<\/button>/);
  });

  test('lists each token by name, first characters, created and last used', () => {
    const html = renderToStaticMarkup(<TokensView tokens={LISTED} />);

    for (const header of ['Name', 'Starts with', 'Created', 'Last used', 'Status']) {
      expect(html).toContain(`>${header}`);
    }
    expect(html).toContain('research agent');
    expect(html).toContain('<code>tok_abcd…</code>');
    expect(html).toContain('<code>tok_wxyz…</code>');
    expect(html).toContain('dateTime="2026-01-04T10:00:00.000Z"');
    expect(html).toContain('dateTime="2026-01-02T10:00:00.000Z"');
    expect(html).not.toContain(TOKENS_EMPTY_TITLE);
  });

  test('revoke asks first: only the confirming row swaps its button for a confirm naming the token', () => {
    const plain = renderToStaticMarkup(<TokensView tokens={LISTED} />);
    const confirming = renderToStaticMarkup(<TokensView tokens={LISTED} confirmingId={1} />);

    expect(plain).not.toContain('Yes, revoke');
    expect(confirming).toContain('Revoke “research agent”?');
    expect(confirming).toMatch(/<button[^>]*>Yes, revoke<\/button>/);
    expect(confirming).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(confirming).not.toContain('>Revoke</button>');
  });

  test('the just-minted token is shown once with a copy button, and never listed whole', () => {
    const html = renderToStaticMarkup(<TokensView tokens={LISTED} fresh={WHOLE_TOKEN} />);
    const table = tablePart(html);

    expect(occurrences(html, WHOLE_TOKEN)).toBe(1);
    expect(html).toContain(`<code>${WHOLE_TOKEN}</code>`);
    expect(html).toMatch(/<button[^>]*>Copy<\/button>/);
    // the table holds the fresh token's first characters, so a whole token in it would be found
    expect(table).toContain('tok_abcd…');
    expect(table).not.toContain(WHOLE_TOKEN);
    expect(html.indexOf(WHOLE_TOKEN)).toBeLessThan(html.indexOf('<table'));
  });

  test('the fresh token says it was copied, and goes away once dismissed', () => {
    const copied = renderToStaticMarkup(<TokensView tokens={LISTED} fresh={WHOLE_TOKEN} copied onDismissFresh={noop} />);
    const dismissed = renderToStaticMarkup(<TokensView tokens={LISTED} />);

    expect(copied).toMatch(/<button[^>]*>Copied<\/button>/);
    expect(copied).toContain('aria-label="Dismiss"');
    expect(occurrences(dismissed, WHOLE_TOKEN)).toBe(0);
  });

  test('shows a failure as an alert', () => {
    const html = renderToStaticMarkup(<TokensView tokens={[]} error="could not load the tokens" />);

    expect(html).toMatch(/role="alert"[^>]*>.*could not load the tokens/);
  });

  test('the page renders the view over its first list, with no fresh token', () => {
    const html = renderToStaticMarkup(<TokensPage initial={LISTED} />);

    expect(html).toEqual(renderToStaticMarkup(<TokensView tokens={LISTED} name="" />));
    expect(renderToStaticMarkup(<TokensPage />)).toContain(TOKENS_EMPTY_TITLE);
  });
});

describe('the page table', () => {
  test('holds the landing page from the app config, then companies, then tokens', () => {
    expect(PAGES.map((page) => page.path)).toEqual([APP.landing.path, '/companies', '/tokens']);
    expect(PAGES[0]?.label).toBe(APP.landing.label);
  });

  test('an unknown path and / land on the landing page', () => {
    expect(pageFor('/').path).toBe(APP.landing.path);
    expect(pageFor('/nowhere').path).toBe(APP.landing.path);
  });

  test('a known path finds its own page', () => {
    expect(pageFor('/tokens').label).toBe('Tokens');
    expect(pageFor(APP.landing.path).label).toBe(APP.landing.label);
  });
});

describe('the pages together', () => {
  test('/ and an unknown path land on the landing path, and PAGES holds only landing, /companies and /tokens', () => {
    expect(pageFor('/').path).toBe(APP.landing.path);
    expect(pageFor('/nowhere').path).toBe(APP.landing.path);
    expect(PAGES).toHaveLength(3);
    expect(PAGES.map((page) => page.path)).toEqual([APP.landing.path, '/companies', '/tokens']);
  });

  test.each(PAGES.map((page) => page.path))('the nav holds one entry per PAGES entry around the page at %s', (path) => {
    const html = renderToStaticMarkup(
      <Shell current={pageFor(path)} onSignOut={noop} onNavigate={noop}>
        {pageFor(path).render()}
      </Shell>,
    );
    const entries = navEntries(html);

    expect(entries.map((entry) => entry.label)).toEqual(PAGES.map((page) => page.label));
    expect(entries.filter((entry) => entry.current).map((entry) => entry.label)).toEqual([pageFor(path).label]);
    expect(html).toContain(renderToStaticMarkup(pageFor(path).render()));
  });
});

describe('HomeView', () => {
  test('holds no form, table or link of its own', () => {
    const html = renderToStaticMarkup(<HomeView />);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<a ');
  });

  test('a given title replaces the landing label in the header', () => {
    const html = renderToStaticMarkup(<HomeView title="Elsewhere" />);
    expect(html).toContain('<h1>Elsewhere</h1>');
    expect(html).not.toContain(`<h1>${APP.landing.label}</h1>`);
  });

  test('heads the page with the landing label from the app config', () => {
    expect(renderToStaticMarkup(<HomeView />)).toContain(`<h1>${APP.landing.label}</h1>`);
  });

  test('says the first page goes into PAGES in src/web/app.tsx', () => {
    const html = renderToStaticMarkup(<HomeView />);
    expect(HOME_EMPTY_DESCRIPTION).toContain('PAGES');
    expect(HOME_EMPTY_DESCRIPTION).toContain('src/web/app.tsx');
    expect(html).toContain(renderToStaticMarkup(<>{HOME_EMPTY_DESCRIPTION}</>));
  });

  test('HomePage renders the view', () => {
    expect(renderToStaticMarkup(<HomePage />)).toBe(renderToStaticMarkup(<HomeView />));
  });
});

describe('request', () => {
  function answering(status: number, body: unknown): typeof fetch {
    return Object.assign(async () => new Response(typeof body === 'string'
      ? body
      : JSON.stringify(body), { status }), {
      preconnect: fetch.preconnect,
    });
  }

  test('returns data from a success envelope', async () => {
    expect(await request('GET', '/x', undefined, answering(200, { success: true, data: 7 }))).toBe(7);
  });

  test('throws the envelope\'s name and message, and copes with a string error or no JSON', async () => {
    const enveloped = await request('GET', '/x', undefined, answering(401, { success: false, error: { name: 'Unauthorized', message: 'sign in first' } })).catch((e: unknown) => e);
    const stringy = await request('GET', '/x', undefined, answering(413, { error: 'too large' })).catch((e: unknown) => e);
    const html = await request('GET', '/x', undefined, answering(429, 'slow down')).catch((e: unknown) => e);

    expect(enveloped).toMatchObject({ status: 401, errorName: 'Unauthorized', message: 'sign in first' });
    expect(stringy).toBeInstanceOf(ApiError);
    expect((html as ApiError).message).toContain('429');
  });

  test('a write carries the CSRF header and a read does not', async () => {
    const seen: Headers[] = [];
    const recording = Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return Response.json({ success: true, data: null });
      },
      { preconnect: fetch.preconnect },
    ) as typeof fetch;

    await request('GET', '/x', undefined, recording);
    await request('POST', '/x', {}, recording);

    expect(seen[0]?.get('x-app-csrf')).toBeNull();
    expect(seen[1]?.get('x-app-csrf')).toBe('1');
  });
});
