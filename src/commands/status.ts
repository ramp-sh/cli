import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { readProjectLink } from '../lib/project-link.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import {
    badge,
    kvTable,
    paint,
    statusLine,
    toneForStatus,
} from '../lib/ui.js';

type StatusCommandOptions = {
    app?: string;
    server?: string;
    apiUrl?: string;
    json: boolean;
    quiet: boolean;
    verbose: boolean;
};

type StatusResponse = {
    data?: {
        id: string;
        stack: string;
        status: string;
        server?: {
            id?: string;
            name?: string;
        };
        latest_deploy?: {
            id: string;
            status: string;
            trigger: string;
            commit_sha?: string | null;
            created_at?: string | null;
        } | null;
    };
};

export async function runStatusCommand(
    options: StatusCommandOptions,
): Promise<number> {
    const resolved = await resolveProjectContext({
        app: options.app,
        server: options.server,
        apiUrl: options.apiUrl,
        json: options.json,
    });

    if (resolved.error !== null || resolved.context === null) {
        process.stderr.write(
            `${statusLine(
                'error',
                resolved.error ?? 'Unable to resolve project context.',
            )}\n`,
        );
        return 1;
    }

    const response = await fetch(
        buildApiV1Endpoint(
            resolved.context.apiUrl,
            `/apps/${resolved.context.app.id}`,
        ),
        {
            headers: buildApiHeaders({
                token: resolved.context.token,
                selectedWorkspaceId: resolved.context.selectedWorkspaceId,
            }),
        },
    );

    if (!response.ok) {
        process.stderr.write(
            `${statusLine(
                'error',
                await describeApiError(response, 'Failed to fetch app status'),
            )}\n`,
        );
        return 1;
    }

    const payload = (await response.json()) as StatusResponse;
    const app = payload.data;

    if (!app) {
        process.stderr.write(
            `${statusLine('error', 'Invalid status response from API.')}\n`,
        );
        return 1;
    }

    if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return 0;
    }

    if (options.quiet) {
        return 0;
    }

    const deploy = app.latest_deploy;
    const link = await readProjectLink();

    const rows: Array<{ key: string; value: string }> = [
        { key: 'app', value: `${paint(app.stack, 'bold')} ${paint(app.id, 'gray')}` },
        { key: 'status', value: badge(app.status, toneForStatus(app.status)) },
        { key: 'server', value: app.server?.name ?? paint('—', 'gray') },
    ];

    if (deploy) {
        const ref = deploy.commit_sha
            ? deploy.commit_sha.startsWith('upl_')
                ? deploy.commit_sha
                : deploy.commit_sha.slice(0, 7)
            : '';
        const sha = ref ? paint(ref, 'gray') : '';
        rows.push({ key: 'deploy', value: `${badge(deploy.status, toneForStatus(deploy.status))} ${sha}`.trim() });
    }

    if (link?.value.ssh_identity) {
        rows.push({ key: 'ssh key', value: paint(link.value.ssh_identity, 'cyan') });
    }

    rows.push({ key: 'via', value: paint(resolved.context.source, 'gray') });

    const table = kvTable(rows);
    const lined = table.split('\n').map((line) => `${paint('│', 'gray')} ${line}`).join('\n');
    process.stdout.write(`${lined}\n`);

    return 0;
}
