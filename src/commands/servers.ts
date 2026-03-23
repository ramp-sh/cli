import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import {
    ensureSelectedWorkspaceId,
    readCredentials,
} from '../lib/auth-store.js';
import {
    appHeader,
    badge,
    box,
    isInteractiveUi,
    paint,
    statusLine,
    toneForStatus,
} from '../lib/ui.js';

type ServersCommandOptions = {
    apiUrl?: string;
    json: boolean;
    quiet: boolean;
    verbose: boolean;
};

export async function runServersCommand(
    options: ServersCommandOptions,
): Promise<number> {
    const credentials = await readCredentials();

    if (credentials === null) {
        process.stderr.write(
            `${statusLine('error', 'Not logged in. Run `ramp login` first.')}\n`,
        );
        return 1;
    }

    const resolvedCredentials = await ensureSelectedWorkspaceId({
        ...credentials,
        apiUrl: options.apiUrl ?? credentials.apiUrl,
    });
    const apiUrl = resolvedCredentials.apiUrl;
    const response = await fetch(buildApiV1Endpoint(apiUrl, '/servers'), {
        headers: buildApiHeaders({
            token: resolvedCredentials.token,
            selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
        }),
    });

    if (!response.ok) {
        process.stderr.write(
            `${statusLine(
                'error',
                await describeApiError(response, 'Failed to list servers'),
            )}\n`,
        );
        return 1;
    }

    const payload = (await response.json()) as {
        data?: Array<{
            id: string;
            name: string;
            status: string;
            ip_address?: string;
            apps_count?: number;
        }>;
    };
    const servers = Array.isArray(payload.data) ? payload.data : [];

    if (options.json) {
        process.stdout.write(`${JSON.stringify({ data: servers }, null, 2)}\n`);
        return 0;
    }

    if (options.quiet) {
        return 0;
    }

    if (servers.length === 0) {
        process.stdout.write(`${statusLine('info', 'No servers found.')}\n`);
        return 0;
    }

    if (isInteractiveUi()) {
        process.stdout.write(
            `${appHeader(
                'Ramp',
                'Servers',
                'Infrastructure currently available in your account context.',
            )}\n\n`,
        );
    }

    const lines = servers.map((server) => {
        const ip = server.ip_address ?? '-';

        return `${paint(server.name, 'bold')}  ${badge(
            server.status,
            toneForStatus(server.status),
        )}  ${paint(ip, 'gray')}  ${paint(`apps:${server.apps_count ?? 0}`, 'gray')}`;
    });

    process.stdout.write(`${box(lines)}\n`);

    return 0;
}
