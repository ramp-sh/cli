import {
  ensureSelectedWorkspaceId,
  readCredentials,
  type StoredCredentials,
} from './auth-store.js';

export const NOT_LOGGED_IN_MESSAGE = 'Not logged in. Run `ramp login` first.';

export type AuthContext = {
  credentials: StoredCredentials;
  apiUrl: string;
};

export async function requireAuth(
  apiUrlOverride?: string,
): Promise<{ context: AuthContext | null; error: string | null }> {
  const credentials = await readCredentials();

  if (credentials === null) {
    return {
      context: null,
      error: NOT_LOGGED_IN_MESSAGE,
    };
  }

  const resolvedCredentials = await ensureSelectedWorkspaceId({
    ...credentials,
    apiUrl: apiUrlOverride ?? credentials.apiUrl,
  });

  return {
    context: {
      credentials: resolvedCredentials,
      apiUrl: resolvedCredentials.apiUrl,
    },
    error: null,
  };
}
