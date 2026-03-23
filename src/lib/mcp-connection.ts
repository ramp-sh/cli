import { buildApiHeaders } from './api-headers.js';
import { describeApiError } from './api-errors.js';
import { buildEndpoint } from './api-url.js';
import { requireAuth } from './require-auth.js';

export type McpConnection = {
  url: string;
  authorization: string;
  token: string;
  apiUrl: string;
  email: string | null;
};

export type McpConnectionLookup =
  | {
      status: 'missing';
    }
  | {
      status: 'invalid';
      message: string;
    }
  | {
      status: 'ok';
      connection: McpConnection;
    };

export async function readMcpConnection(apiUrlOverride?: string): Promise<McpConnectionLookup> {
  const auth = await requireAuth(apiUrlOverride);

  if (auth.error || !auth.context) {
    return {
      status: 'missing',
    };
  }

  try {
    const response = await fetch(buildEndpoint(auth.context.apiUrl, '/api/v1/auth/me'), {
      headers: buildApiHeaders({
        token: auth.context.credentials.token,
        selectedWorkspaceId: auth.context.credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      return {
        status: 'invalid',
        message: await describeApiError(response, 'Failed to verify stored credentials'),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      status: 'invalid',
      message: `Failed to verify stored credentials: ${message}`,
    };
  }

  return {
    status: 'ok',
    connection: {
      url: buildEndpoint(auth.context.apiUrl, '/mcp/ramp'),
      authorization: `Bearer ${auth.context.credentials.token}`,
      token: auth.context.credentials.token,
      apiUrl: auth.context.apiUrl,
      email: auth.context.credentials.email ?? null,
    },
  };
}
