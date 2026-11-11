
import type { Column } from '@open-tomato/components';

import {
  Badge,
  Banner,
  Button,
  ConfirmInline,
  Content,
  EmptyState,
  FormattedDate,
  FormField,
  Table,
  TextInput,
} from '@open-tomato/components';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

import { auth, type TokenSummary } from '../api.ts';

/** What the page needs from the server; the real one by default, a stand-in in tests. */
export interface TokenApi {
  listTokens(): Promise<TokenSummary[]>
  createToken(name: string): Promise<{ token: string, summary: TokenSummary }>
  revokeToken(id: number): Promise<TokenSummary>
}

/** The `id` of the mint form's name input, which its label points at. */
const NAME_INPUT_ID = 'token-name';

/** The longest name the mint form accepts. */
const NAME_MAX_LENGTH = 80;

/** What the token list says while it holds no token. */
export const TOKENS_EMPTY_TITLE = 'No tokens yet';

/** The props of {@link TokensView}: the list, the mint form's state, the fresh token and the handlers. */
export interface TokensViewProps {
  /** The tokens to list, each by its summary; a summary never holds the whole token. */
  readonly tokens: readonly TokenSummary[]
  /** The name typed into the mint form so far. */
  readonly name?: string
  /** The token just minted, shown once above the list; unset once it is dismissed. */
  readonly fresh?: string
  /** Set once the fresh token went to the clipboard. */
  readonly copied?: boolean
  /** Why the last load, mint or revoke failed, shown as an alert. */
  readonly error?: string
  /** Set while a mint is in flight. */
  readonly busy?: boolean
  /** The token whose revoke is waiting on its confirm, by its `id`. */
  readonly confirmingId?: number
  readonly onNameChange?: (name: string) => void
  readonly onMint?: () => void
  readonly onCopy?: () => void
  readonly onDismissFresh?: () => void
  /** Asks to revoke a token, which opens its confirm in place of its Revoke button. */
  readonly onAskRevoke?: (id: number) => void
  readonly onConfirmRevoke?: (id: number) => void
  readonly onCancelRevoke?: () => void
}

function When({ iso }: { readonly iso: string | null }) {
  return iso === null
    ? <span>—</span>
    : <FormattedDate date={iso} />;
}

/** The token just minted, with a copy button and a dismiss; it is not shown again after. */
function FreshToken({ token, copied = false, onCopy, onDismiss }: {
  readonly token: string
  readonly copied?: boolean
  readonly onCopy?: () => void
  readonly onDismiss?: () => void
}) {
  return (
    <Banner tone="success" role="status" title="Copy this token now" onClose={onDismiss}>
      <Content direction="col" gap="sm">
        <span>It is shown once and is not stored; only its hash is.</span>
        <Content direction="row" align="center" gap="sm">
          <code>{token}</code>
          <Button variant="secondary" size="sm" onClick={() => onCopy?.()}>
            {copied
              ? 'Copied'
              : 'Copy'}
          </Button>
        </Content>
        <span>
          Send it as <code>Authorization: Bearer &lt;token&gt;</code> to <code>/api</code>.
        </span>
      </Content>
    </Banner>
  );
}

function MintForm({ name = '', busy = false, onNameChange, onMint }: TokensViewProps) {
  const blank = name.trim().length === 0;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (!blank && !busy) onMint?.();
  }

  return (
    <form onSubmit={submit}>
      <Content direction="row" align="end" gap="sm">
        <FormField label="Name" htmlFor={NAME_INPUT_ID} hint="One per agent or HTTP client, so each can be revoked on its own.">
          <TextInput
            id={NAME_INPUT_ID}
            placeholder="e.g. research agent"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(next: string) => onNameChange?.(next)}
          />
        </FormField>
        <Button variant="primary" disabled={blank || busy} onClick={() => onMint?.()}>
          {busy
            ? 'Creating…'
            : 'Create token'}
        </Button>
      </Content>
    </form>
  );
}

function columns({ confirmingId, onAskRevoke, onConfirmRevoke, onCancelRevoke }: TokensViewProps): Column<TokenSummary>[] {
  return [
    { key: 'name', header: 'Name', overflow: 'truncate', cell: (token) => token.name },
    { key: 'prefix', header: 'Starts with', width: 140, cell: (token) => <code>{token.prefix}…</code> },
    { key: 'createdAt', header: 'Created', width: 140, cell: (token) => <When iso={token.createdAt} /> },
    { key: 'lastUsedAt', header: 'Last used', width: 140, cell: (token) => <When iso={token.lastUsedAt} /> },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      cell: (token) => token.revokedAt === null
        ? <Badge tone="success" dot>active</Badge>
        : <Badge tone="danger">revoked</Badge>,
    },
    {
      key: 'actions',
      header: <span aria-label="Actions" />,
      width: 260,
      align: 'end',
      cell: (token) => {
        if (token.revokedAt !== null) return null;
        if (token.id === confirmingId) {
          return (
            <ConfirmInline
              message={`Revoke “${token.name}”? Anything using it is refused from now on.`}
              confirmLabel="Yes, revoke"
              danger
              onConfirm={() => onConfirmRevoke?.(token.id)}
              onCancel={() => onCancelRevoke?.()}
            />
          );
        }
        return (
          <Button variant="ghost" size="sm" onClick={() => onAskRevoke?.(token.id)}>
            Revoke
          </Button>
        );
      },
    },
  ];
}

/**
 * The API tokens page as a pure view, on library components: a page header, the mint form, the
 * token just minted shown once with a copy button, and a table of tokens by name, first
 * characters, created, last used and an active or revoked badge. Revoking a token first swaps
 * its Revoke button for a confirm naming it. Pure: it holds no state and calls no API.
 */
export function TokensView(props: TokensViewProps) {
  const { tokens, fresh, copied, error, onCopy, onDismissFresh } = props;
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>API tokens</h1>
      </Content>
      <MintForm {...props} />
      {fresh !== undefined && <FreshToken token={fresh} copied={copied} onCopy={onCopy} onDismiss={onDismissFresh} />}
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {tokens.length === 0
        ? <EmptyState title={TOKENS_EMPTY_TITLE} description="Create one above to open the API to an agent or an HTTP client." />
        : <Table columns={columns(props)} data={tokens} getRowId={(token) => String(token.id)} />}
    </Content>
  );
}

/** The props of {@link TokensPage}. */
export interface TokensPageProps {
  /** The server calls. Defaults to the real ones; tests inject a fake. */
  readonly api?: TokenApi
  /** The first list, for a render with no server. */
  readonly initial?: readonly TokenSummary[]
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error
    ? failure.message
    : fallback;
}

/** The API tokens page: holds the list, the mint form and the revoke confirm, and calls `api`. */
export function TokensPage({ api = auth, initial = [] }: TokensPageProps) {
  const [tokens, setTokens] = useState<readonly TokenSummary[]>(initial);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | undefined>();

  const reload = useCallback(async () => {
    try {
      setTokens(await api.listTokens());
    } catch (failure: unknown) {
      setError(messageOf(failure, 'could not load the tokens'));
    }
  }, [api]);

  useEffect(() => {
    // Loads the tokens on mount. Fire-and-forget: `reload` catches its own failure into `error`.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the setState calls run after the awaited request, not synchronously in the effect
    void reload();
  }, [reload]);

  async function mint(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await api.createToken(name);
      setFresh(token);
      setCopied(false);
      setName('');
      await reload();
    } catch (failure: unknown) {
      setError(messageOf(failure, 'could not create the token'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number): Promise<void> {
    setConfirmingId(undefined);
    setError(undefined);
    try {
      await api.revokeToken(id);
      await reload();
    } catch (failure: unknown) {
      setError(messageOf(failure, 'could not revoke the token'));
    }
  }

  function copy(): void {
    if (fresh === undefined) return;
    // Fire-and-forget: both outcomes are handled in `then`, so nothing awaits the copy.
    void navigator.clipboard?.writeText(fresh).then(
      () => setCopied(true),
      () => setError('could not copy the token; select it and copy it by hand'),
    );
  }

  return (
    <TokensView
      tokens={tokens}
      name={name}
      fresh={fresh}
      copied={copied}
      error={error}
      busy={busy}
      confirmingId={confirmingId}
      onNameChange={setName}
      onMint={() => void mint()}
      onCopy={copy}
      onDismissFresh={() => setFresh(undefined)}
      onAskRevoke={setConfirmingId}
      onConfirmRevoke={(id) => void revoke(id)}
      onCancelRevoke={() => setConfirmingId(undefined)}
    />
  );
}
