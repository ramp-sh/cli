import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import {
    badge,
    paint,
    sectionHeader,
    statusLine,
} from '../lib/ui.js';

type ReleasesCommandOptions = {
    app?: string;
    server?: string;
    apiUrl?: string;
    json: boolean;
    quiet: boolean;
    verbose: boolean;
};

type ReleaseItem = {
    id: string;
    release_id: string;
    message: string | null;
    trigger: string;
    status: string;
    is_current: boolean;
    created_at: string;
};

type ReleasesResponse = {
    ok?: boolean;
    releases?: ReleaseItem[];
};

export async function runReleasesCommand(
    options: ReleasesCommandOptions,
): Promise<number> {
    const resolved = await resolveProjectContext({
        app: options.app,
        server: options.server,
        apiUrl: options.apiUrl,
        json: options.json,
    });

    if (resolved.error !== null || resolved.context === null) {
        process.stderr.write(
            `${resolved.error ?? 'Unable to resolve project context.'}\n`,
        );
        return 1;
    }

    const app = resolved.context.app;

    try {
        const response = await fetch(
            buildApiV1Endpoint(
                resolved.context.apiUrl,
                `/apps/${app.id}/releases`,
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
                `${statusLine('error', await describeApiError(response, 'Failed to fetch releases'))}\n`,
            );
            return 1;
        }

        const payload = (await response.json()) as ReleasesResponse;
        const releases = payload.releases ?? [];

        if (options.json) {
            process.stdout.write(
                `${JSON.stringify(payload, null, 2)}\n`,
            );
            return 0;
        }

        if (releases.length === 0) {
            process.stdout.write(
                `${statusLine('info', `No releases found for ${paint(app.stack, 'bold')}.`)}\n`,
            );
            return 0;
        }

        if (!options.quiet) {
            process.stdout.write(
                `${sectionHeader(`Releases — ${app.stack}`, `${releases.length} release(s)`)}\n\n`,
            );
        }

        for (const release of releases) {
            const statusBadge = formatStatusBadge(release.status);
            const currentMarker = release.is_current
                ? paint(' ← current', 'green')
                : '';
            const trigger =
                release.trigger === 'cli_upload'
                    ? 'upload'
                    : release.trigger;

            const date = new Date(release.created_at);
            const dateStr = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });

            process.stdout.write(
                `  ${statusBadge} ${paint(release.release_id, 'bold')}${currentMarker}\n`,
            );
            process.stdout.write(
                `    ${paint(release.message ?? '(no message)', 'gray')}  ·  ${trigger}  ·  ${dateStr}\n\n`,
            );
        }

        return 0;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(
            `${statusLine('error', `Failed to fetch releases: ${message}`)}\n`,
        );
        return 1;
    }
}

function formatStatusBadge(status: string): string {
    switch (status) {
        case 'success':
            return badge('success', 'success');
        case 'failed':
            return badge('failed', 'error');
        case 'running':
            return badge('running', 'warning');
        case 'pending':
            return badge('pending', 'neutral');
        case 'rolled_back':
            return badge('rolled back', 'warning');
        case 'cancelled':
            return badge('cancelled', 'neutral');
        default:
            return badge(status, 'neutral');
    }
}
