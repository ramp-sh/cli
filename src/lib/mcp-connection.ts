import { ensureSelectedWorkspaceId, readCredentials } from './auth-store.js';
import { buildApiHeaders } from './api-headers.js';
import { describeApiError } from './api-errors.js';
import { buildEndpoint } from './api-url.js';

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

export async function readMcpConnection(
    apiUrlOverride?: string,
): Promise<McpConnectionLookup> {
    const credentials = await readCredentials();

    if (credentials === null) {
        return {
            status: 'missing',
        };
    }

    const resolvedCredentials = await ensureSelectedWorkspaceId({
        ...credentials,
        apiUrl: apiUrlOverride ?? credentials.apiUrl,
    });
    const apiUrl = resolvedCredentials.apiUrl;

    try {
        const response = await fetch(buildEndpoint(apiUrl, '/api/v1/auth/me'), {
            headers: buildApiHeaders({
                token: resolvedCredentials.token,
                selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
            }),
        });

        if (!response.ok) {
            return {
                status: 'invalid',
                message: await describeApiError(
                    response,
                    'Failed to verify stored credentials',
                ),
            };
        }
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';

        return {
            status: 'invalid',
            message: `Failed to verify stored credentials: ${message}`,
        };
    }

    return {
        status: 'ok',
        connection: {
            url: buildEndpoint(apiUrl, '/mcp/ramp'),
            authorization: `Bearer ${resolvedCredentials.token}`,
            token: resolvedCredentials.token,
            apiUrl,
            email: resolvedCredentials.email ?? null,
        },
    };
}
