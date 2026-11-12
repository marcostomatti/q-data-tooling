import type { ReactElement } from 'react';

import { readFileSync } from 'node:fs';

import { Button, ConfirmPopover, Content, FormField, SectionCard, TextInput } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { APP } from '../../src/app-config.ts';
import { ApiError, request, type TokenSummary } from '../../src/web/api.ts';
import { pageFor, PAGES, Shell } from '../../src/web/app.tsx';
import { LoginPage, LoginView } from '../../src/web/pages/login.tsx';
import { SUMMARY_PATH, SUMMARY_TITLE } from '../../src/web/pages/summary/logic.ts';
import {
  FreshToken,
  MintForm,
  REVOKE_CONFIRM_LABEL,
  REVOKE_LABEL,
  revokeMessage,
  tokenColumns,
  TOKENS_EMPTY_TITLE,
  TokensPage,
  TokensView,
} from '../../src/web/pages/tokens.tsx';

import { settle } from './settle.tsx';

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

  test('shows the brand, the page label as the topbar\'s only h1, a sign-out action and the page', () => {
    const html = renderShell('/tokens');

    expect(html).toContain(`aria-label="${APP.name}"`);
    expect(html).toMatch(/<header[^>]*>.*<h1[^>]*>Tokens<\/h1>.*<\/header>/);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
    expect(html).toContain('<p>page body</p>');
  });

  test('puts the theme switch in the topbar, offering the other theme', () => {
    const light = renderShell('/tokens');
    const dark = renderToStaticMarkup(
      <Shell current={pageFor('/tokens')} onSignOut={noop} onNavigate={noop} theme="dark">
        <p>page body</p>
      </Shell>,
    );

    expect(light).toMatch(/<header[^>]*>.*aria-label="Switch to dark theme".*<\/header>/);
    expect(dark).toMatch(/<header[^>]*>.*aria-label="Switch to light theme".*<\/header>/);
  });
});

/** The class list of the first element the pattern's group captures, split into names. */
function classesOf(html: string, pattern: RegExp): string[] {
  return (html.match(pattern)?.[1] ?? '').split(' ');
}

describe('Shell layout', () => {
  test('fills the viewport through the AppShell `viewport` flag, so the stylesheet sizes no root box', () => {
    const frame = classesOf(renderShell('/'), /^<div class="([^"]*)"/);

    expect(frame).toContain('h-dvh');
    expect(STYLES).not.toContain('#root');
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

  test('pushes the theme switch and then sign-out to the far end of the topbar, after the title that takes the free space', () => {
    expect(renderShell('/tokens')).toMatch(/<h1[^>]*>Tokens<\/h1>.*aria-label="Switch to dark theme".*<button[^>]*>Sign out<\/button><\/header>/);
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

  test('the mint form puts the create button on the right of the name input, inside the field', () => {
    type Node = ReactElement<{ children: Node | Node[], direction?: string }>;
    const form = MintForm({ tokens: [], name: 'ci runner' }) as Node;
    const field = form.props.children as Node;
    const row = field.props.children as Node;
    const [input, button] = row.props.children as Node[];

    expect(field.type).toBe(FormField);
    expect(row.type).toBe(Content);
    expect(row.props.direction).toBe('row');
    expect(input?.type).toBe(TextInput);
    expect(button?.type).toBe(Button);
  });

  test('the just-minted token sits in a SectionCard, not a success banner', () => {
    const card = FreshToken({ token: WHOLE_TOKEN });

    expect(card.type).toBe(SectionCard);
    expect(renderToStaticMarkup(<TokensView tokens={LISTED} fresh={WHOLE_TOKEN} />)).not.toContain('bg-success-wash');
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

  test('puts Revoke behind a ConfirmPopover naming the token, so only the confirm revokes it', () => {
    const revoked: number[] = [];
    const cell = tokenColumns({ onRevoke: (id) => revoked.push(id) }).find((column) => column.key === 'actions')
      ?.cell?.(LISTED[0]!) as ReactElement<Record<string, unknown>>;

    expect(cell.type).toBe(ConfirmPopover);
    expect(cell.props.message).toBe(revokeMessage('research agent'));
    expect(revokeMessage('research agent')).toContain('Revoke “research agent”?');
    expect(cell.props.confirmLabel).toBe(REVOKE_CONFIRM_LABEL);
    expect(cell.props.danger).toBe(true);
    const trigger = cell.props.children as ReactElement<Record<string, unknown>>;
    expect(trigger.props.children).toBe(REVOKE_LABEL);
    expect(trigger.props.onClick).toBeUndefined();
    expect(revoked).toEqual([]);

    (cell.props.onConfirm as () => void)();
    expect(revoked).toEqual([1]);
  });

  test('the fixed columns leave the name 120px in a 1024px window with the sidebar open', () => {
    // Measured in the browser: the page's content is the window less the 264px sidebar and 44px
    // of padding, so 716px at 1024. The name column takes what the fixed widths leave.
    const tableWidth = 1024 - 264 - 44;
    const fixed = tokenColumns({}).reduce((sum, column) => sum + (typeof column.width === 'number'
      ? column.width
      : 0), 0);
    expect(tableWidth - fixed).toBeGreaterThanOrEqual(120);
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

  test('the page revokes through api.revokeToken and reloads the list', async () => {
    const calls: string[] = [];
    const api = {
      listTokens: async () => {
        calls.push('list');
        return LISTED;
      },
      createToken: async () => ({ token: WHOLE_TOKEN, summary: LISTED[0]! }),
      revokeToken: async (id: number) => {
        calls.push(`revoke ${id}`);
        return LISTED[0]!;
      },
    };
    const page = await settle(<TokensPage api={api} initial={LISTED} />);
    calls.length = 0;

    (page.tree.props.onRevoke as (id: number) => void)(1);
    await page.flush();
    page.stop();
    expect(calls).toEqual(['revoke 1', 'list']);
  });

  test('the page renders the view over its first list, with no fresh token', () => {
    const html = renderToStaticMarkup(<TokensPage initial={LISTED} />);

    expect(html).toEqual(renderToStaticMarkup(<TokensView tokens={LISTED} name="" />));
    expect(renderToStaticMarkup(<TokensPage />)).toContain(TOKENS_EMPTY_TITLE);
  });
});

describe('the page table', () => {
  test('lands on the summary, then holds filings, companies, then tokens', () => {
    expect(APP.landing).toEqual({ path: SUMMARY_PATH, label: SUMMARY_TITLE });
    expect(PAGES.map((page) => page.path)).toEqual([SUMMARY_PATH, '/filings', '/companies', '/tokens']);
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
  test('/ and an unknown path land on the summary, and PAGES holds only /summary, /filings, /companies and /tokens', () => {
    expect(pageFor('/').path).toBe(SUMMARY_PATH);
    expect(pageFor('/nowhere').path).toBe(SUMMARY_PATH);
    expect(PAGES).toHaveLength(4);
  });

  test.each(PAGES.map((page) => page.path))('the nav holds one entry per PAGES entry around the page at %s', (path) => {
    const html = renderToStaticMarkup(
      <Shell current={pageFor(path)} onSignOut={noop} onNavigate={noop}>
        {pageFor(path).render(path)}
      </Shell>,
    );
    const entries = navEntries(html);

    expect(entries.map((entry) => entry.label)).toEqual(PAGES.map((page) => page.label));
    expect(entries.filter((entry) => entry.current).map((entry) => entry.label)).toEqual([pageFor(path).label]);
    expect(html).toContain(renderToStaticMarkup(pageFor(path).render(path)));
  });

  test.each(PAGES.map((page) => page.path))('the page at %s leaves its title to the topbar and draws no h1 of its own', (path) => {
    expect(renderToStaticMarkup(pageFor(path).render(path))).not.toContain('<h1');
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
