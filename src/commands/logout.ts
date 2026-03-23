import process from 'node:process';
import { clearCredentials, readCredentials } from '../lib/auth-store.js';
import { buildEndpoint } from '../lib/api-url.js';

type LogoutCommandOptions = {
    apiUrl?: string;
    quiet: boolean;
    verbose: boolean;
};

export async function runLogoutCommand(
    options: LogoutCommandOptions,
): Promise<number> {
    const credentials = await readCredentials();

    if (credentials === null) {
        if (!options.quiet) {
            process.stdout.write('Already logged out.\n');
        }
        return 0;
    }

    const apiUrl = options.apiUrl ?? credentials.apiUrl;

    try {
        await fetch(buildEndpoint(apiUrl, '/api/v1/auth/logout'), {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${credentials.token}`,
            },
        });
    } catch {
        // Ignore network/API errors and clear local token anyway.
    }

    await clearCredentials();
    if (!options.quiet) {
        process.stdout.write('Logged out.\n');
    }

    return 0;
}
