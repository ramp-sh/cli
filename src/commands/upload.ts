import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { createProjectArchive } from '../lib/archive.js';
import { formatFileSize } from '../lib/format-size.js';
import { ensureLocalOctaneReady } from '../lib/octane-preflight.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type UploadCommandOptions = {
    app?: string;
    server?: string;
    msg?: string;
    apiUrl?: string;
    json: boolean;
    quiet: boolean;
    verbose: boolean;
};

type UploadResponse = {
    ok?: boolean;
    errors?: string[];
    deploy?: {
        id: string;
        release_id: string;
        status: string;
        trigger: string;
        config_synced?: boolean | null;
    };
};

export async function runUploadCommand(
    options: UploadCommandOptions,
): Promise<number> {
    const octaneReadiness = await ensureLocalOctaneReady();

    if (!octaneReadiness.ok) {
        process.stderr.write(
            `${statusLine('error', octaneReadiness.message)}\n`,
        );

        for (const detail of octaneReadiness.details) {
            process.stderr.write(`${paint('·', 'red', 'stderr')} ${detail}\n`);
        }

        return 1;
    }

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

    // Check app is upload mode
    if (
        (app as { deploy_mode?: string }).deploy_mode !== undefined &&
        (app as { deploy_mode?: string }).deploy_mode !== 'upload'
    ) {
        process.stderr.write(
            `${statusLine('error', `App "${app.stack}" is a Git-based app. Use \`ramp deploy\` instead.`)}\n`,
        );
        return 1;
    }

    if (!options.quiet && !options.json) {
        process.stdout.write(
            `${statusLine('info', `Packaging ${paint(app.stack, 'bold')}...`)}\n`,
        );
    }

    // Package project
    const projectRoot = process.cwd();
    const { archivePath, error: archiveError } =
        await createProjectArchive(projectRoot);

    if (archiveError) {
        process.stderr.write(`${statusLine('error', archiveError)}\n`);

        if (archivePath) {
            await unlink(archivePath).catch(() => {});
        }

        return 1;
    }

    // Show archive size
    const archiveStat = await stat(archivePath);
    const archiveSize = formatFileSize(archiveStat.size);

    if (!options.quiet && !options.json) {
        process.stdout.write(
            `${statusLine('info', `Archive: ${archiveSize}`)}\n`,
        );
        process.stdout.write(`${statusLine('info', 'Uploading...')}\n`);
    }

    // Upload via multipart form
    const archiveBuffer = await readFile(archivePath);
    const blob = new Blob([archiveBuffer], {
        type: 'application/gzip',
    });

    const formData = new FormData();
    formData.append('archive', blob, path.basename(archivePath));

    if (options.msg) {
        formData.append('message', options.msg);
    }

    // Clean up local archive
    await unlink(archivePath).catch(() => {});

    try {
        const response = await fetch(
            buildApiV1Endpoint(
                resolved.context.apiUrl,
                `/apps/${app.id}/upload`,
            ),
            {
                method: 'POST',
                headers: buildApiHeaders({
                    token: resolved.context.token,
                    selectedWorkspaceId: resolved.context.selectedWorkspaceId,
                }),
                body: formData,
            },
        );

        const payload = (await response.json()) as UploadResponse;

        if (!response.ok || payload.ok !== true) {
            const errors = payload.errors ?? [
                await describeApiError(response, 'Upload failed'),
            ];
            process.stderr.write(`${statusLine('error', 'Upload failed:')}\n`);

            for (const err of errors) {
                process.stderr.write(`${paint('·', 'red', 'stderr')} ${err}\n`);
            }

            return 1;
        }

        if (options.json) {
            process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
            return 0;
        }

        if (!options.quiet) {
            const lines = [
                statusLine(
                    'success',
                    `Deploy queued for ${paint(app.stack, 'bold')}`,
                ),
                keyHint(`Release: ${payload.deploy?.release_id ?? 'unknown'}`),
            ];

            if (payload.deploy?.config_synced === true) {
                lines.push(
                    statusLine('info', 'Config changes detected and synced.'),
                );
            }

            process.stdout.write(`${box(lines)}\n`);
        }

        return 0;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(
            `${statusLine('error', `Upload failed: ${message}`)}\n`,
        );
        return 1;
    }
}
