import { constants as fsConstants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import {
    ensureSelectedWorkspaceId,
    readCredentials,
} from '../lib/auth-store.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type ImportRenderCommandOptions = {
    file?: string;
    stdin: boolean;
    repo?: string;
    branch?: string;
    path?: string;
    output?: string;
    stdout: boolean;
    json: boolean;
    force: boolean;
    apiUrl?: string;
    quiet: boolean;
    verbose: boolean;
};

type ImportBlueprintResponse = {
    ok?: boolean;
    data?: {
        provider: string;
        source_type: 'raw' | 'github';
        ramp_yaml: string;
        warnings: string[];
        unsupported: string[];
        source_meta?: {
            path?: string | null;
        };
        detected?: {
            stack?: string;
            services?: Array<{ name?: string }>;
            resources?: Array<{ name?: string }>;
        };
    };
    errors?: string[];
};

export async function runImportRenderCommand(
    options: ImportRenderCommandOptions,
): Promise<number> {
    const credentials = await readCredentials();

    if (credentials === null) {
        process.stderr.write('Not logged in. Run `ramp login` first.\n');
        return 1;
    }

    const resolvedCredentials = await ensureSelectedWorkspaceId({
        ...credentials,
        apiUrl: options.apiUrl ?? credentials.apiUrl,
    });
    const apiUrl = resolvedCredentials.apiUrl;

    let payload:
        | {
              provider: 'render';
              source_type: 'raw';
              content: string;
          }
        | {
              provider: 'render';
              source_type: 'github';
              repo: string;
              branch: string;
              path?: string;
          };

    if (typeof options.repo === 'string' && options.repo.trim() !== '') {
        const branch = options.branch?.trim() || 'main';

        payload = {
            provider: 'render',
            source_type: 'github',
            repo: options.repo.trim(),
            branch,
            ...(options.path?.trim() ? { path: options.path.trim() } : {}),
        };
    } else {
        const content = await readBlueprintInput(options);

        if (content === null) {
            process.stderr.write(
                `${statusLine(
                    'error',
                    'Provide a Render blueprint file, pipe stdin with `--stdin`, or use --repo.',
                )}\n`,
            );
            return 1;
        }

        payload = {
            provider: 'render',
            source_type: 'raw',
            content,
        };
    }

    try {
        const response = await fetch(buildApiV1Endpoint(apiUrl, '/blueprints/import'), {
            method: 'POST',
            headers: buildApiHeaders({
                token: resolvedCredentials.token,
                selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
                contentType: 'application/json',
            }),
            body: JSON.stringify(payload),
        });

        const body = (await response.json()) as ImportBlueprintResponse;

        if (!response.ok || body.ok !== true || !body.data) {
            process.stderr.write(
                `${statusLine(
                    'error',
                    await describeApiError(response, 'Import failed'),
                )}\n`,
            );
            return 1;
        }

        const outputPath = options.output?.trim() || 'ramp.yaml';

        if (options.json) {
            process.stdout.write(
                `${JSON.stringify(
                    {
                        ok: true,
                        output: options.stdout ? null : outputPath,
                        data: body.data,
                    },
                    null,
                    2,
                )}\n`,
            );

            return 0;
        }

        if (options.stdout) {
            process.stdout.write(`${body.data.ramp_yaml}`);
            return 0;
        }

        if (!options.force && (await fileExists(outputPath))) {
            process.stderr.write(
                `${statusLine(
                    'error',
                    `${outputPath} already exists. Re-run with --force or choose --output.`,
                )}\n`,
            );
            return 1;
        }

        await writeFile(outputPath, body.data.ramp_yaml, 'utf8');

        if (!options.quiet) {
            const warnings = [...(body.data.warnings ?? []), ...(body.data.unsupported ?? [])];
            const lines = [
                statusLine(
                    'success',
                    `Wrote ${paint(outputPath, 'bold')} from Render blueprint.`,
                ),
                keyHint(
                    `Stack ${body.data.detected?.stack ?? 'unknown'} · ${body.data.detected?.services?.length ?? 0} services · ${body.data.detected?.resources?.length ?? 0} resources`,
                ),
            ];

            if (warnings.length > 0) {
                lines.push('');
                lines.push(...warnings.map((warning) => `• ${warning}`));
            }

            lines.push('');
            lines.push(keyHint('Next: review ramp.yaml, commit/push it, then run `ramp validate`.'));

            process.stdout.write(`${box(lines)}\n`);
        }

        return 0;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(
            `${statusLine('error', `Import failed: ${message}`)}\n`,
        );
        return 1;
    }
}

async function readBlueprintInput(
    options: ImportRenderCommandOptions,
): Promise<string | null> {
    if (options.stdin) {
        let input = '';

        for await (const chunk of process.stdin) {
            input += chunk;
        }

        return input.trim() === '' ? null : input;
    }

    if (typeof options.file === 'string' && options.file.trim() !== '') {
        return readFile(options.file.trim(), 'utf8');
    }

    return null;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}
