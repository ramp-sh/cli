import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import {
    ensureSelectedWorkspaceId,
    readCredentials,
    type StoredCredentials,
} from '../lib/auth-store.js';
import { findConfigFile } from '../lib/find-config-file.js';
import {
    appHeader,
    box,
    isInteractiveUi,
    keyHint,
    kvTable,
    paint,
    statusLine,
} from '../lib/ui.js';

type ValidateCommandOptions = {
    file?: string;
    server?: string;
    json: boolean;
    strict: boolean;
    quiet: boolean;
    verbose: boolean;
    apiUrl: string;
};

type ValidationError = {
    field: string;
    message: string;
};

type ValidationResult = {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
};

export async function runValidateCommand(
    options: ValidateCommandOptions,
): Promise<number> {
    const configFilePath = await findConfigFile(options.file);

    if (configFilePath === null) {
        return outputResult(
            {
                valid: false,
                errors: [
                    {
                        field: options.file ? 'file' : 'ramp.yaml',
                        message: options.file
                            ? `Config file not found: ${options.file}`
                            : 'No ramp.yaml found in current directory or parent directories.',
                    },
                ],
                warnings: [],
            },
            options,
        );
    }

    const credentials = await readCredentials();

    if (credentials === null || credentials.token === '') {
        return outputResult(
            {
                valid: false,
                errors: [
                    {
                        field: 'remote',
                        message: 'No CLI token found. Run `ramp login` first.',
                    },
                ],
                warnings: [],
            },
            options,
        );
    }

    const resolvedCredentials = await ensureSelectedWorkspaceId({
        ...credentials,
        apiUrl: options.apiUrl,
    });
    const yamlContent = await readFile(configFilePath, 'utf8');

    if (!options.json && !options.quiet && isInteractiveUi()) {
        process.stdout.write(
            `${appHeader(
                'Ramp',
                'Validate ramp.yaml',
                'Remote config validation with semantic checks.',
            )}\n\n`,
        );
    }

    if (options.verbose && !options.json) {
        process.stdout.write(
            `${box([
                kvTable([
                    {
                        key: 'config',
                        value: paint(configFilePath, 'bold'),
                    },
                    {
                        key: 'api',
                        value: options.apiUrl,
                    },
                    {
                        key: 'strict',
                        value: options.strict ? 'yes' : 'no',
                    },
                ]),
            ])}\n`,
        );
    }

    const remoteResult = await runRemoteValidation(
        yamlContent,
        options.apiUrl,
        resolvedCredentials,
        options.server,
    );

    return outputResult(remoteResult, options);
}

function outputResult(
    result: ValidationResult,
    options: ValidateCommandOptions,
): number {
    const hasWarnings = result.warnings.length > 0;
    const warningsFail = options.strict && result.valid && hasWarnings;
    const exitCode = result.valid ? (warningsFail ? 2 : 0) : 1;

    if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

        return exitCode;
    }

    if (result.valid) {
        if (!options.quiet) {
            const lines = [
                statusLine('success', 'ramp.yaml is valid'),
                keyHint('Validated with remote semantic checks.'),
            ];

            if (result.warnings.length > 0) {
                lines.push('');
                lines.push(...result.warnings.map(formatWarningLine));
            }

            process.stdout.write(`${box(lines)}\n`);
        }

        if (warningsFail) {
            process.stderr.write(
                `${statusLine(
                    'warning',
                    'Strict mode enabled: warnings treated as errors.',
                )}\n`,
            );
        }

        return exitCode;
    }

    process.stderr.write(
        `${box([
            statusLine('error', 'ramp.yaml is invalid'),
            ...result.errors.map(formatErrorLine),
            ...result.warnings.map(formatWarningLine),
        ])}\n`,
    );

    return exitCode;
}

function formatErrorLine(error: ValidationError): string {
    return `${paint('•', 'red', 'stderr')} ${error.field}: ${error.message}`;
}

function formatWarningLine(warning: ValidationError): string {
    return `${paint('•', 'yellow')} ${warning.field}: ${warning.message}`;
}

async function runRemoteValidation(
    yaml: string,
    apiUrl: string,
    credentials: StoredCredentials,
    server?: string,
): Promise<ValidationResult> {
    const endpoint = new URL(buildApiV1Endpoint(apiUrl, '/validate'));

    if (typeof server === 'string' && server.trim() !== '') {
        const serverId = await resolveServerId(apiUrl, credentials, server.trim());

        if (serverId !== null) {
            endpoint.searchParams.set('server_id', serverId);
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: buildApiHeaders({
                token: credentials.token,
                contentType: 'application/yaml',
            }),
            body: yaml,
            signal: controller.signal,
        });

        if (response.status === 401) {
            return {
                valid: false,
                errors: [
                    {
                        field: 'remote',
                        message:
                            'Unauthorized. Run `ramp login` to refresh your token.',
                    },
                ],
                warnings: [],
            };
        }

        const json = (await response.json()) as Partial<ValidationResult>;
        const result: ValidationResult = {
            valid: json.valid === true,
            errors: Array.isArray(json.errors)
                ? (json.errors as ValidationError[])
                : [],
            warnings: Array.isArray(json.warnings)
                ? (json.warnings as ValidationError[])
                : [],
        };

        if (!response.ok && result.errors.length === 0) {
            result.errors.push({
                field: 'remote',
                message: `Remote validation failed with status ${response.status}.`,
            });
            result.valid = false;
        }

        return result;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';

        return {
            valid: false,
            errors: [
                {
                    field: 'remote',
                    message: `Remote validation request failed: ${message}`,
                },
            ],
            warnings: [],
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveServerId(
    apiUrl: string,
    credentials: StoredCredentials,
    serverInput: string,
): Promise<string | null> {
    try {
        const response = await fetch(buildApiV1Endpoint(apiUrl, '/servers'), {
            headers: buildApiHeaders({
                token: credentials.token,
                selectedWorkspaceId: credentials.selectedWorkspaceId,
            }),
        });

        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as {
            data?: Array<{ id: string; name: string }>;
        };

        const servers = Array.isArray(payload.data) ? payload.data : [];
        const match = servers.find(
            (server) =>
                server.id === serverInput || server.name === serverInput,
        );

        return match?.id ?? null;
    } catch {
        return null;
    }
}
