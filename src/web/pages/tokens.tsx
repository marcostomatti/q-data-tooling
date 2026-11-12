
import type { Column } from '@open-tomato/components';

import {
  Badge,
  Banner,
  Button,
  ConfirmPopover,
  Content,
  EmptyState,
  FormattedDate,
  FormField,
  Icon,
  IconButton,
  SectionCard,
  Table,
  TextInput,
} from '@open-tomato/components';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

import { auth, messageOf, type TokenSummary } from '../api.ts';

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
export interface TokensViewProps extends TokenRowHandlers {
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
  readonly onNameChange?: (name: string) => void
  readonly onMint?: () => void
  readonly onCopy?: () => void
  readonly onDismissFresh?: () => void
}

function When({ iso }: { readonly iso: string | null }) {
  return iso === null
    ? <span>—</span>
    : <FormattedDate date={iso} />;
}

/** The token just minted, with a copy button and a dismiss; it is not shown again after. */
/** The props of {@link FreshToken}: the token just minted and the card's handlers. */
export interface FreshTokenProps {
  /** The whole token, shown this once. */
  readonly token: string
  /** Set once the token went to the clipboard. */
  readonly copied?: boolean
  readonly onCopy?: () => void
  readonly onDismiss?: () => void
}

/**
 * The token just minted, shown once in the library's `SectionCard`: a title and a subtitle saying
 * it is not stored, a dismiss button in the header, the token with a copy button, and a footer
 * line on how to send it.
 *
 * @param props - The token and the handlers, as {@link FreshTokenProps} lists them.
 * @returns The card.
 */
export function FreshToken({ token, copied = false, onCopy, onDismiss }: FreshTokenProps) {
  return (
    <SectionCard
      role="status"
      title="Copy this token now"
      subtitle="It is shown once and is not stored; only its hash is."
      action={<IconButton icon={<Icon name="x" size={16} />} label="Dismiss" onClick={() => onDismiss?.()} />}
      footer={(
        <span>
          Send it as <code>Authorization: Bearer &lt;token&gt;</code> to <code>/api</code>.
        </span>
      )}
    >
      <Content direction="row" align="center" gap="sm">
        <code>{token}</code>
        <Button variant="secondary" size="sm" onClick={() => onCopy?.()}>
          {copied
            ? 'Copied'
            : 'Copy'}
        </Button>
      </Content>
    </SectionCard>
  );
}

/**
 * The form that mints a token: the name field, whose control is a row of the name input and the
 * create button on its right, so the button lines up with the input and the hint sits under
 * both. The button is disabled while the name is blank or a mint is in flight.
 *
 * @param props - The typed name, the busy flag and the handlers, from {@link TokensViewProps}.
 * @returns The form.
 */
export function MintForm({ name = '', busy = false, onNameChange, onMint }: TokensViewProps) {
  const blank = name.trim().length === 0;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (!blank && !busy) onMint?.();
  }

  return (
    <form onSubmit={submit}>
      <FormField label="Name" htmlFor={NAME_INPUT_ID} hint="One per agent or HTTP client, so each can be revoked on its own.">
        <Content direction="row" align="center" gap="sm">
          <TextInput
            id={NAME_INPUT_ID}
            placeholder="e.g. research agent"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(next: string) => onNameChange?.(next)}
          />
          <Button variant="primary" disabled={blank || busy} onClick={() => onMint?.()}>
            {busy
              ? 'Creating…'
              : 'Create token'}
          </Button>
        </Content>
      </FormField>
    </form>
  );
}

/** The label of a token row's button that opens the revoke confirm. */
export const REVOKE_LABEL = 'Revoke';

/** The confirm button of the revoke popover, naming the action again. */
export const REVOKE_CONFIRM_LABEL = 'Yes, revoke';

/**
 * The question the revoke popover asks, naming the token and what revoking does.
 *
 * @param name - The token's name.
 * @returns The question.
 */
export function revokeMessage(name: string): string {
  return `Revoke “${name}”? Anything using it is refused from now on.`;
}

/** What the token table asks of its page: revoke a token once its popover confirms. */
export interface TokenRowHandlers {
  /** Revokes the token with the id; called only after the popover's confirm. */
  readonly onRevoke?: (id: number) => void
}

/**
 * The token table's columns, in order: the name, which takes the width the others leave, the
 * first characters, created, last used, an active or revoked badge, and last a Revoke button
 * behind a `ConfirmPopover`, as the Summary page's Remove is, so a token is revoked only once
 * confirmed and the column needs room for the button alone. Each fixed width is its widest
 * content, mostly the mono header, plus the cell's 32px of padding.
 *
 * @param handlers - The row handlers, as {@link TokenRowHandlers} lists them.
 * @returns The columns, for the library's `Table`.
 */
export function tokenColumns({ onRevoke }: TokenRowHandlers): Column<TokenSummary>[] {
  return [
    { key: 'name', header: 'Name', overflow: 'truncate', cell: (token) => token.name },
    { key: 'prefix', header: 'Starts with', width: 144, cell: (token) => <code>{token.prefix}…</code> },
    { key: 'createdAt', header: 'Created', width: 108, cell: (token) => <When iso={token.createdAt} /> },
    { key: 'lastUsedAt', header: 'Last used', width: 120, cell: (token) => <When iso={token.lastUsedAt} /> },
    {
      key: 'status',
      header: 'Status',
      width: 104,
      cell: (token) => token.revokedAt === null
        ? <Badge tone="success" dot>active</Badge>
        : <Badge tone="danger">revoked</Badge>,
    },
    {
      key: 'actions',
      header: <span aria-label="Actions" />,
      width: 108,
      align: 'end',
      cell: (token) => token.revokedAt !== null
        ? null
        : (
          <ConfirmPopover
            message={revokeMessage(token.name)}
            confirmLabel={REVOKE_CONFIRM_LABEL}
            danger
            align="end"
            onConfirm={() => onRevoke?.(token.id)}
          >
            <Button variant="ghost" size="sm">
              {REVOKE_LABEL}
            </Button>
          </ConfirmPopover>
        ),
    },
  ];
}

/**
 * The API tokens page as a pure view, on library components: the mint form, the token just
 * minted shown once with a copy button, and a table of tokens by name, first characters,
 * created, last used and an active or revoked badge. A token's Revoke button opens a popover
 * naming it, and only its confirm revokes the token. The title is the shell's topbar `h1`, so the view draws no
 * heading. Pure: it holds no state and calls no API.
 */
export function TokensView(props: TokensViewProps) {
  const { tokens, fresh, copied, error, onCopy, onDismissFresh } = props;
  return (
    <Content gap="lg">
      <MintForm {...props} />
      {fresh !== undefined && <FreshToken token={fresh} copied={copied} onCopy={onCopy} onDismiss={onDismissFresh} />}
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {tokens.length === 0
        ? <EmptyState title={TOKENS_EMPTY_TITLE} description="Create one above to open the API to an agent or an HTTP client." />
        : <Table columns={tokenColumns(props)} data={tokens} getRowId={(token) => String(token.id)} />}
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

/** The API tokens page: holds the list and the mint form, and calls `api`. */
export function TokensPage({ api = auth, initial = [] }: TokensPageProps) {
  const [tokens, setTokens] = useState<readonly TokenSummary[]>(initial);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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
      onNameChange={setName}
      onMint={() => void mint()}
      onCopy={copy}
      onDismissFresh={() => setFresh(undefined)}
      onRevoke={(id) => void revoke(id)}
    />
  );
}
