import process from 'node:process';
import {
    ensureSelectedWorkspaceId,
    readCredentials,
} from '../lib/auth-store.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { buildEndpoint } from '../lib/api-url.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type WhoAmICommandOptions = {
    json: boolean;
    showToken: boolean;
    apiUrl?: string;
    quiet: boolean;
    verbose: boolean;
};

type MeResponse = {
    user?: {
        id?: string;
        email?: string;
        name?: string;
    };
};

export async function runWhoAmICommand(
    options: WhoAmICommandOptions,
): Promise<number> {
    const credentials = await readCredentials();

    if (credentials === null) {
        process.stderr.write('Not logged in. Run `ramp login` first.\n');
        return 1;
    }

    if (options.showToken) {
        if (options.json) {
            process.stdout.write(
                `${JSON.stringify(
                    {
                        user: {
                            email: credentials.email ?? null,
                        },
                        apiUrl: options.apiUrl ?? credentials.apiUrl,
                        token: credentials.token,
                        authorization: `Bearer ${credentials.token}`,
                    },
                    null,
                    2,
                )}\n`,
            );
        } else if (!options.quiet) {
            process.stdout.write(
                `${box([
                    statusLine(
                        'success',
                        `Logged in as ${paint(credentials.email ?? 'unknown', 'bold')}`,
                    ),
                    `Authorization: Bearer ${credentials.token}`,
                    keyHint('Use `ramp mcp:cursor` for a ready-to-paste MCP snippet.'),
                ])}\n`,
            );
        }

        return 0;
    }

    const resolvedCredentials = await ensureSelectedWorkspaceId({
        ...credentials,
        apiUrl: options.apiUrl ?? credentials.apiUrl,
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
            process.stderr.write(
                `${statusLine(
                    'error',
                    await describeApiError(response, 'Failed to fetch profile'),
                )}\n`,
            );
            return 1;
        }

        const payload = (await response.json()) as MeResponse;
        const user = payload.user;

        if (!user?.email) {
            process.stderr.write('Unexpected response from API.\n');
            return 1;
        }

        if (options.json) {
            process.stdout.write(
                `${JSON.stringify(
                    {
                        user,
                        apiUrl,
                    },
                    null,
                    2,
                )}\n`,
            );
        } else if (!options.quiet) {
            process.stdout.write(
                `Logged in as ${user.email} (${user.name ?? 'unknown'}).\n`,
            );

            if (options.verbose) {
                process.stdout.write(`API: ${apiUrl}\n`);
            }
        }

        return 0;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(`Failed to fetch profile: ${message}\n`);
        return 1;
    }
}
