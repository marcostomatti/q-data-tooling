import {
  AuthHeading,
  AuthShell,
  Banner,
  Button,
  Content,
  FormField,
  Monogram,
  TextInput,
} from '@open-tomato/components';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

import { APP } from '../../app-config.ts';
import { auth, type AuthMode } from '../api.ts';

/** The `id` of the password input, which its label points at. */
const PASSWORD_INPUT_ID = 'login-password';

/** The props of {@link LoginView}: the mode, the password form's state and its two handlers. */
export interface LoginViewProps {
  readonly mode: AuthMode
  /** Set when the OIDC callback sent the browser back here, from `?error=oidc`. */
  readonly oidcError?: boolean
  /** The password typed so far. */
  readonly password?: string
  /** Why the last password sign-in failed, shown as an alert. */
  readonly error?: string
  /** Set while a password sign-in is in flight. */
  readonly busy?: boolean
  readonly onPasswordChange?: (password: string) => void
  readonly onSubmit?: () => void
}

function Brand() {
  return (
    <Content direction="row" align="center" gap="sm">
      <Monogram name={APP.name} tone="primary" size="sm" />
      <span>{APP.name}</span>
    </Content>
  );
}

function Alert({ children }: { readonly children: ReactNode }) {
  return (
    <Banner tone="danger" role="alert">
      {children}
    </Banner>
  );
}

function PasswordForm({ password = '', error, busy = false, onPasswordChange, onSubmit }: LoginViewProps) {
  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    onSubmit?.();
  }

  return (
    <form onSubmit={submit}>
      <Content direction="col" gap="md">
        <FormField
          label="Password"
          htmlFor={PASSWORD_INPUT_ID}
          hint={<>Lost it? Run <code>bun run reset-credentials</code>.</>}
        >
          <TextInput
            id={PASSWORD_INPUT_ID}
            type="password"
            autoComplete="current-password"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the sign-in page's only field; typing the password is all the page is for.
            autoFocus
            required
            value={password}
            invalid={error !== undefined}
            onChange={(next: string) => onPasswordChange?.(next)}
          />
        </FormField>
        {error !== undefined && <Alert>{error}</Alert>}
        <Button variant="primary" block disabled={busy || password.length === 0} onClick={() => onSubmit?.()}>
          {busy
            ? 'Signing in…'
            : 'Sign in'}
        </Button>
      </Content>
    </form>
  );
}

/**
 * The sign-in screen on the library's `AuthShell`, for whichever mode `AUTH_MODE` set: `none`
 * says sign-in is off and shows no form, `password` shows the password form with the
 * `bun run reset-credentials` hint, and `oidc` shows a button to `/auth/oidc/start`, under an
 * alert when the callback refused the last attempt. Pure: it holds no state and calls no API.
 */
export function LoginView(props: LoginViewProps) {
  const { mode, oidcError = false } = props;
  if (mode === 'none') {
    return (
      <AuthShell brand={<Brand />} eyebrow="sign-in is off">
        <AuthHeading title="No login is configured" sub="Set AUTH_MODE in .env to sign in here." />
        <Banner tone="info">
          With no <code>AUTH_MODE</code>, only the <code>API_KEY</code> opens the API. See
          docs/auth.md.
        </Banner>
      </AuthShell>
    );
  }
  if (mode === 'oidc') {
    return (
      <AuthShell brand={<Brand />} eyebrow="welcome back">
        <AuthHeading title="Sign in" sub={`With the account ${APP.name} is set up for.`} />
        {oidcError && <Alert>That sign-in was refused. Try again, or check the OIDC settings in .env.</Alert>}
        <Button asChild variant="primary" block>
          <a href="/auth/oidc/start">Continue to your provider</a>
        </Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell brand={<Brand />} eyebrow="welcome back">
      <AuthHeading title="Sign in" />
      <PasswordForm {...props} />
    </AuthShell>
  );
}

/** The props of {@link LoginPage}. */
export interface LoginPageProps {
  readonly mode: AuthMode
  /** Set when the OIDC callback sent the browser back here, from `?error=oidc`. */
  readonly oidcError?: boolean
  readonly onSignedIn: () => void
  /** Signs in with a password. Defaults to the server call; tests inject a fake. */
  readonly login?: (password: string) => Promise<unknown>
}

/** The sign-in page: holds the password form's state and signs in through `login`. */
export function LoginPage({ mode, oidcError = false, onSignedIn, login = auth.login }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await login(password);
      onSignedIn();
    } catch (failure: unknown) {
      setError(failure instanceof Error
        ? failure.message
        : 'sign-in failed');
      setBusy(false);
    }
  }

  return (
    <LoginView
      mode={mode}
      oidcError={oidcError}
      password={password}
      error={error}
      busy={busy}
      onPasswordChange={setPassword}
      onSubmit={() => void submit()}
    />
  );
}
