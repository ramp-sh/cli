import os from 'node:os';
import process from 'node:process';
import { saveCredentials } from '../lib/auth-store.js';
import { buildEndpoint } from '../lib/api-url.js';
import { tryOpenBrowser } from '../lib/browser.js';
import {
    box,
    isInteractiveUi,
    keyHint,
    paint,
    sectionHeader,
    stepper,
    statusLine,
} from '../lib/ui.js';

type LoginCommandOptions = {
    email?: string;
    token?: string;
    deviceName?: string;
    apiUrl: string;
    quiet: boolean;
    verbose: boolean;
};

type StartCliLoginResponse = {
    device_code: string;
    user_code: string;
    verification_url: string;
    poll_interval_seconds: number;
    expires_at: string;
};

type PollCliLoginResponse = {
    status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'invalid';
    token?: string;
    expires_at?: string;
    user?: {
        email?: string;
        name?: string;
    };
    error?: string;
};

type MeResponse = {
    user?: {
        email?: string;
        name?: string;
    };
    current_workspace_id?: string | null;
};

type ErrorResponse = {
    message?: string;
    error?: string;
    errors?: Record<string, string[] | string>;
};

export async function runLoginCommand(
    options: LoginCommandOptions,
): Promise<number> {
    if (typeof options.token === 'string' && options.token.trim() !== '') {
        return loginWithToken(options.token.trim(), options.apiUrl, options);
    }

    const deviceName = resolveDeviceName(options.deviceName);

    let interrupted = false;
    const onSigint = () => {
        interrupted = true;
    };

    process.once('SIGINT', onSigint);

    try {
        if (isInteractiveUi() && !options.quiet) {
            process.stdout.write(
                `${sectionHeader(
                    'Authenticate this machine',
                    'Open the browser, approve this CLI device, and store a CLI token locally.',
                )}\n\n`,
            );
            process.stdout.write(
                `${stepper('Flow', [
                    { label: 'Open browser', state: 'current' },
                    { label: 'Approve device', state: 'pending' },
                    { label: 'Save token', state: 'pending' },
                ])}\n\n`,
            );
        }

        const startResponse = await fetch(
            buildEndpoint(options.apiUrl, '/api/v1/auth/cli-login/start'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    device_name: deviceName,
                }),
            },
        );

        if (!startResponse.ok) {
            const errorMessage = await extractErrorMessage(startResponse);
            process.stderr.write(
                `${statusLine('error', `Failed to start browser login: ${errorMessage}`)}\n`,
            );
            return 1;
        }

        const startPayload = (await startResponse.json()) as StartCliLoginResponse;

        if (
            typeof startPayload.device_code !== 'string' ||
            startPayload.device_code === '' ||
            typeof startPayload.user_code !== 'string' ||
            startPayload.user_code === '' ||
            typeof startPayload.verification_url !== 'string' ||
            startPayload.verification_url === ''
        ) {
            process.stderr.write(
                `${statusLine('error', 'Unexpected login response from API.')}\n`,
            );
            return 1;
        }

        const opened = tryOpenBrowser(startPayload.verification_url);

        if (!options.quiet) {
            process.stdout.write(
                `${box([
                    statusLine(
                        opened ? 'success' : 'info',
                        opened
                            ? `Opened ${paint(startPayload.verification_url, 'bold')} in your browser.`
                            : 'Open the verification URL below in your browser.',
                    ),
                    keyHint(`Verification URL: ${startPayload.verification_url}`),
                    keyHint(`Code: ${startPayload.user_code}`),
                    keyHint(`Device: ${deviceName}`),
                ])}\n`,
            );
        }

        const pollIntervalMs = Math.max(
            0,
            Math.floor((startPayload.poll_interval_seconds ?? 2) * 1000),
        );

        while (!interrupted) {
            const pollResponse = await fetch(
                buildEndpoint(options.apiUrl, '/api/v1/auth/cli-login/poll'),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({
                        device_code: startPayload.device_code,
                    }),
                },
            );

            const pollPayload = (await safeParseJson<PollCliLoginResponse>(pollResponse)) ?? {
                status: 'invalid',
            };

            if (pollPayload.status === 'approved' && typeof pollPayload.token === 'string' && pollPayload.token !== '') {
                const profile = await fetchProfile(pollPayload.token, options.apiUrl);
                const email = pollPayload.user?.email;

                await saveCredentials({
                    token: pollPayload.token,
                    apiUrl: options.apiUrl,
                    email,
                    selectedWorkspaceId: profile.currentWorkspaceId ?? undefined,
                    updatedAt: new Date().toISOString(),
                });

                if (!options.quiet) {
                    process.stdout.write(
                        `${box([
                            statusLine(
                                'success',
                                `Logged in${email ? ` as ${paint(email, 'bold')}` : ''}.`,
                            ),
                            keyHint(
                                `Token expires at ${pollPayload.expires_at ?? startPayload.expires_at}`,
                            ),
                        ])}\n`,
                    );
                }

                return 0;
            }

            if (pollPayload.status === 'denied') {
                process.stderr.write(
                    `${statusLine('error', 'CLI login request was denied in the browser.')}\n`,
                );
                return 1;
            }

            if (pollPayload.status === 'expired') {
                process.stderr.write(
                    `${statusLine('error', 'CLI login request expired. Run `ramp login` again.')}\n`,
                );
                return 1;
            }

            if (pollPayload.status === 'consumed') {
                process.stderr.write(
                    `${statusLine('error', 'CLI login request was already used. Run `ramp login` again.')}\n`,
                );
                return 1;
            }

            if (pollPayload.status === 'invalid' || !pollResponse.ok) {
                const pollError =
                    pollPayload.error ||
                    (await extractErrorMessage(pollResponse)) ||
                    'CLI login request could not be found.';

                process.stderr.write(
                    `${statusLine('error', pollError)}\n`,
                );
                return 1;
            }

            await delay(pollIntervalMs);
        }

        process.stderr.write(`${statusLine('error', 'Cancelled.')}\n`);
        return 130;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(
            `${statusLine('error', `Login failed: ${message}`)}\n`,
        );

        return 1;
    } finally {
        process.removeListener('SIGINT', onSigint);
    }
}

async function loginWithToken(
    token: string,
    apiUrl: string,
    options: LoginCommandOptions,
): Promise<number> {
    try {
        const response = await fetch(buildEndpoint(apiUrl, '/api/v1/auth/me'), {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            process.stderr.write(
                `${statusLine('error', 'Invalid API token.')}\n`,
            );
            return 1;
        }

        const payload = (await response.json()) as MeResponse;

        await saveCredentials({
            token,
            apiUrl,
            email: payload.user?.email,
            selectedWorkspaceId: payload.current_workspace_id ?? undefined,
            updatedAt: new Date().toISOString(),
        });

        if (!options.quiet) {
            process.stdout.write(
                `${statusLine(
                    'success',
                    `Logged in with API token${payload.user?.email ? ` as ${paint(payload.user.email, 'bold')}` : ''}.`,
                )}\n`,
            );
        }

        return 0;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        process.stderr.write(
            `${statusLine('error', `Login failed: ${message}`)}\n`,
        );
        return 1;
    }
}

async function fetchProfile(
    token: string,
    apiUrl: string,
): Promise<{ currentWorkspaceId: string | null }> {
    try {
        const response = await fetch(buildEndpoint(apiUrl, '/api/v1/auth/me'), {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return { currentWorkspaceId: null };
        }

        const payload = (await response.json()) as MeResponse;

        return {
            currentWorkspaceId: payload.current_workspace_id ?? null,
        };
    } catch {
        return { currentWorkspaceId: null };
    }
}

function resolveDeviceName(explicitDeviceName?: string): string {
    const candidate = explicitDeviceName?.trim();

    if (candidate) {
        return candidate.slice(0, 100);
    }

    const hostname = os.hostname().trim();
    const platform = os.platform();
    const label = hostname === '' ? `Ramp CLI (${platform})` : `${hostname} (${platform})`;

    return label.slice(0, 100);
}

function delay(ms: number): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function extractErrorMessage(response: Response): Promise<string> {
    try {
        const payload = (await safeParseJson<ErrorResponse>(response)) as ErrorResponse | null;

        if (!payload) {
            return `Request failed with status ${response.status}.`;
        }

        if (typeof payload.error === 'string' && payload.error !== '') {
            return payload.error;
        }

        if (typeof payload.message === 'string' && payload.message !== '') {
            return payload.message;
        }

        if (payload.errors && typeof payload.errors === 'object') {
            for (const value of Object.values(payload.errors)) {
                if (Array.isArray(value) && value.length > 0) {
                    return String(value[0]);
                }

                if (typeof value === 'string' && value !== '') {
                    return value;
                }
            }
        }
    } catch {
        // Ignore body parse errors.
    }

    return `Request failed with status ${response.status}.`;
}

async function safeParseJson<T>(response: Response): Promise<T | null> {
    try {
        return (await response.clone().json()) as T;
    } catch {
        return null;
    }
}
