/**
 * The one place the app's name and landing page live. A clone of the template renames the app
 * here, and the server (service id, the paths it answers with the web app), the MCP server and
 * the web app (title, brand, the first page in the nav) all read it.
 */
export const APP = {
  /** The service id the chassis and the MCP server report, and the prefix of the session cookie. */
  id: 'template-service',
  /** The name a person reads: the browser title and the brand in the app shell. */
  name: 'SEC filings',
  /** The first page behind the sign-in, where `/` lands: the summary of the selected companies. */
  landing: { path: '/summary', label: 'Summary' },
} as const;
