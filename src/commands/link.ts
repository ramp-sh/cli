import path from 'node:path';
import process from 'node:process';
import {
    ensureSelectedWorkspaceId,
    readCredentials,
} from '../lib/auth-store.js';
import { findConfigFile } from '../lib/find-config-file.js';
import {
    lookupApps,
    lookupAppsByStack,
    promptForAppSelection,
    readStackFromConfigFile,
} from '../lib/project-resolver.js';
import { writeProjectLink } from '../lib/project-link.js';
import {
    box,
    isInteractiveUi,
    paint,
    sectionHeader,
    statusLine,
    stepper,
} from '../lib/ui.js';

type LinkCommandOptions = {
    app?: string;
    server?: string;
    json: boolean;
    apiUrl?: string;
    quiet: boolean;
    verbose: boolean;
};

export async function runLinkCommand(
    options: LinkCommandOptions,
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
    const configFilePath = await findConfigFile();

    if (isInteractiveUi() && !options.quiet && !options.json) {
        process.stdout.write(
            `${sectionHeader(
                'Link this directory',
                'Choose which Ramp app this project should target locally.',
            )}\n\n`,
        );
        process.stdout.write(
            `${stepper('Flow', [
                { label: 'Find matching apps', state: 'current' },
                { label: 'Choose app', state: 'pending' },
                { label: 'Write local link', state: 'pending' },
            ])}\n\n`,
        );
    }

    const stack =
        options.app ??
        (configFilePath ? await readStackFromConfigFile(configFilePath) : null);

    let matches = stack
        ? await lookupAppsByStack({
              apiUrl,
              credentials: resolvedCredentials,
              stack,
              server: options.server,
          })
        : await lookupApps({
              apiUrl,
              credentials: resolvedCredentials,
              server: options.server,
          });
    let usedFallbackLookup = false;

    if (matches.error !== null) {
        process.stderr.write(`${statusLine('error', matches.error)}\n`);
        return 1;
    }

    if (matches.apps.length === 0) {
        if (stack !== null) {
            const fallback = await lookupApps({
                apiUrl,
                credentials: resolvedCredentials,
                server: options.server,
            });

            if (fallback.error !== null) {
                process.stderr.write(
                    `${statusLine('error', fallback.error)}\n`,
                );
                return 1;
            }

            matches = fallback;
            usedFallbackLookup = true;
        }

        if (matches.apps.length === 0) {
            process.stderr.write(
                `${statusLine(
                    'error',
                    stack !== null
                        ? `No app found for stack '${stack}', and no other apps are available to link.`
                        : 'No apps are available to link for this account.',
                )}\n`,
            );
            return 1;
        }
    }

    if (options.json && (matches.apps.length > 1 || usedFallbackLookup)) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    linked: false,
                    reason: usedFallbackLookup
                        ? 'stack-mismatch-requires-confirmation'
                        : 'ambiguous',
                    stack,
                    matches: matches.apps,
                },
                null,
                2,
            )}\n`,
        );

        return 1;
    }

    const selected = await selectApp(
        matches.apps,
        options.json,
        usedFallbackLookup,
    );

    if (selected === null) {
        process.stderr.write(
            `${statusLine('error', 'No app selected.')}\n`,
        );
        return 1;
    }

    const projectRoot = configFilePath
        ? path.dirname(configFilePath)
        : process.cwd();
    const linkPath = await writeProjectLink(projectRoot, {
        app_id: selected.id,
        server_id: selected.server?.id ?? null,
        stack: selected.stack,
        linked_at: new Date().toISOString(),
    });

    if (options.json) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    linked: true,
                    stack: selected.stack,
                    app_id: selected.id,
                    server: selected.server,
                    path: linkPath,
                },
                null,
                2,
            )}\n`,
        );
    } else if (!options.quiet) {
        if (isInteractiveUi()) {
            process.stdout.write(
                `${sectionHeader(
                    'Project linked',
                    'Ramp will use this app for status, deploy, and other project-aware commands.',
                )}\n\n`,
            );
        }

        process.stdout.write(
            `${box([
                statusLine(
                    'success',
                    `Linked this directory to ${paint(selected.stack, 'bold')}${selected.server?.name ? ` on ${paint(selected.server.name, 'bold')}` : ''}.`,
                ),
                statusLine('info', `Saved: ${paint(linkPath, 'bold')}`),
            ])}\n`,
        );
    }

    return 0;
}

async function selectApp(
    apps: Awaited<ReturnType<typeof lookupAppsByStack>>['apps'],
    json: boolean,
    forcePrompt: boolean,
): Promise<(typeof apps)[number] | null> {
    if (apps.length === 1 && !forcePrompt) {
        return apps[0];
    }

    if (json) {
        return null;
    }

    return promptForAppSelection(apps);
}
