import { Command } from 'commander';
import { runAppsCommand } from './commands/apps.js';
import { runCreateCommand } from './commands/create.js';
import { runDeployCommand } from './commands/deploy.js';
import {
    runEnvDelete,
    runEnvList,
    runEnvPull,
    runEnvPush,
    runEnvSet,
} from './commands/env.js';
import { runExecCommand } from './commands/exec.js';
import { runInitCommand } from './commands/init.js';
import { runImportRenderCommand } from './commands/import-render.js';
import { runLinkCommand } from './commands/link.js';
import { runLoginCommand } from './commands/login.js';
import { runLogsCommand } from './commands/logs.js';
import { runMcpCursorCommand } from './commands/mcp-cursor.js';
import { runMcpLoginCommand } from './commands/mcp-login.js';
import { runDashboardCommand, runOpenCommand } from './commands/open.js';
import { runLogoutCommand } from './commands/logout.js';
import { runReleasesCommand } from './commands/releases.js';
import { runRollbackCommand } from './commands/rollback.js';
import { runDbBackupCommand, runDbRestoreCommand } from './commands/db.js';
import { runSavedCommand } from './commands/run.js';
import { runUploadCommand } from './commands/upload.js';
import { runServersCommand } from './commands/servers.js';
import { runStatusCommand } from './commands/status.js';
import { runUnlinkCommand } from './commands/unlink.js';
import { runValidateCommand } from './commands/validate.js';
import { runWorkspaceCommand } from './commands/workspace.js';
import { runWhoAmICommand } from './commands/whoami.js';
import { runAiBridgeCommand } from './commands/ai-bridge.js';
import { configureRampHelp } from './lib/help.js';
import { brandBanner, isInteractiveUi } from './lib/ui.js';

const program = new Command();

program.name('ramp').description('Ramp CLI').version('0.1.0');
configureRampHelp(program);
program.optionsGroup('Global options:');
program
    .option('--quiet', 'Suppress non-essential output')
    .option('--verbose', 'Show debug information');

if (process.argv.length === 2) {
    if (isInteractiveUi()) {
        process.stdout.write(`${brandBanner()}\n\n`);
    } else {
        process.stdout.write('ramp.sh\n\n');
    }

    program.outputHelp();
    process.exit(0);
}

type GlobalOptions = {
    quiet?: boolean;
    verbose?: boolean;
};

function globals(): { quiet: boolean; verbose: boolean } {
    const opts = program.opts<GlobalOptions>();

    return {
        quiet: opts.quiet === true,
        verbose: opts.verbose === true,
    };
}

program.commandsGroup('Getting started:');

program
    .command('init')
    .helpGroup('Getting started:')
    .description('Create a starter ramp.yaml in current directory')
    .option(
        '--template <name>',
        'Template: custom|laravel|laravel-octane|node-api|nextjs|static|worker|adonis',
    )
    .option('-y, --yes', 'Use defaults without prompts')
    .option('--print', 'Print generated YAML to stdout')
    .option('--json', 'Output JSON metadata for scripting')
    .option('--force', 'Overwrite existing ramp.yaml without prompt')
    .action(
        async (options: {
            template?: string;
            yes?: boolean;
            print?: boolean;
            json?: boolean;
            force?: boolean;
        }) => {
            const code = await runInitCommand({
                template: options.template,
                yes: options.yes === true,
                print: options.print === true,
                json: options.json === true,
                force: options.force === true,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

const importCommand = program
    .command('import')
    .helpGroup('Getting started:')
    .description('Import config from another platform');

importCommand
    .command('render [file]')
    .description('Convert a Render blueprint into ramp.yaml')
    .option('--stdin', 'Read blueprint content from stdin')
    .option('--repo <owner/repo>', 'Read render.yaml from a GitHub repository')
    .option('--branch <name>', 'Repository branch to read from', 'main')
    .option('--path <path>', 'Blueprint path inside the GitHub repository')
    .option('--output <path>', 'Write ramp.yaml to a custom path')
    .option('--stdout', 'Print ramp.yaml to stdout instead of writing a file')
    .option('--json', 'Output JSON metadata')
    .option('--force', 'Overwrite the output file if it already exists')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            file: string | undefined,
            options: {
                stdin?: boolean;
                repo?: string;
                branch?: string;
                path?: string;
                output?: string;
                stdout?: boolean;
                json?: boolean;
                force?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runImportRenderCommand({
                file,
                stdin: options.stdin === true,
                repo: options.repo,
                branch: options.branch,
                path: options.path,
                output: options.output,
                stdout: options.stdout === true,
                json: options.json === true,
                force: options.force === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program.commandsGroup('Project workflow:');

program
    .command('logs')
    .helpGroup('Project workflow:')
    .description('Fetch app runtime logs')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--type <type>', 'Log type: laravel|php|caddy|systemd', 'laravel')
    .option('--service <service>', 'Service id or name (for systemd)')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            type?: 'laravel' | 'php' | 'caddy' | 'systemd';
            service?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runLogsCommand({
                app: options.app,
                server: options.server,
                type: options.type ?? 'laravel',
                service: options.service,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('open')
    .alias('browser')
    .helpGroup('Project workflow:')
    .description('Open the deployed app if possible, otherwise fall back to Ramp')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runOpenCommand({
                app: options.app,
                server: options.server,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('dashboard')
    .helpGroup('Project workflow:')
    .description('Open Ramp dashboard, or the current app page when inside a project')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runDashboardCommand({
                app: options.app,
                server: options.server,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('exec <command...>')
    .helpGroup('Project workflow:')
    .description('Run arbitrary command on app server')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            commandParts: string[],
            options: {
                app?: string;
                server?: string;
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runExecCommand({
                app: options.app,
                server: options.server,
                command: commandParts.join(' '),
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('run [name]')
    .helpGroup('Project workflow:')
    .description('Run saved command by name')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--list', 'List saved commands for current app')
    .option('--service <service>', 'Filter/list by service id or name')
    .option(
        '--param <key=value...>',
        'Template parameter (repeatable)',
        (value, previous: string[]) => {
            previous.push(value);
            return previous;
        },
        [],
    )
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            name: string | undefined,
            options: {
                app?: string;
                server?: string;
                list?: boolean;
                service?: string;
                param?: string[];
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runSavedCommand({
                app: options.app,
                server: options.server,
                name,
                list: options.list === true,
                service: options.service,
                params: options.param ?? [],
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

const env = program
    .command('env')
    .helpGroup('Project workflow:')
    .description('Manage environment variables');

env.command('list')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--service <service>', 'Service id or name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            service?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runEnvList({
                app: options.app,
                server: options.server,
                service: options.service,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

env.command('set <key> <value>')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--service <service>', 'Service id or name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            key: string,
            value: string,
            options: {
                app?: string;
                server?: string;
                service?: string;
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runEnvSet({
                app: options.app,
                server: options.server,
                service: options.service,
                key,
                value,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

env.command('delete <key>')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--service <service>', 'Service id or name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            key: string,
            options: {
                app?: string;
                server?: string;
                service?: string;
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runEnvDelete({
                app: options.app,
                server: options.server,
                service: options.service,
                key,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

env.command('pull')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--service <service>', 'Service id or name')
    .option('--output <path>', 'Output .env path', '.env')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            service?: string;
            output?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runEnvPull({
                app: options.app,
                server: options.server,
                service: options.service,
                output: options.output ?? '.env',
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

env.command('push')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--service <service>', 'Service id or name')
    .option('--file <path>', 'Input .env path', '.env')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            service?: string;
            file?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runEnvPush({
                app: options.app,
                server: options.server,
                service: options.service,
                file: options.file ?? '.env',
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('apps')
    .helpGroup('Project workflow:')
    .description('List apps in your account')
    .option('--stack <name>', 'Filter by stack name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            stack?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runAppsCommand({
                stack: options.stack,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('servers')
    .helpGroup('Project workflow:')
    .description('List servers in your account')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(async (options: { json?: boolean; apiUrl?: string }) => {
        const code = await runServersCommand({
            json: options.json === true,
            apiUrl: options.apiUrl,
            ...globals(),
        });

        process.exitCode = code;
    });

program
    .command('create')
    .helpGroup('Getting started:')
    .description('Create a new app and link current directory')
    .option('--server <id-or-name>', 'Server id or name')
    .option('--name <stack>', 'App stack/name')
    .option('--source <type>', 'App source: repo or upload')
    .option('--repository <owner/repo>', 'GitHub repository full name')
    .option('--branch <branch>', 'Repository branch', 'main')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            server?: string;
            name?: string;
            source?: string;
            repository?: string;
            branch?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runCreateCommand({
                server: options.server,
                name: options.name,
                source: options.source,
                repository: options.repository,
                branch: options.branch,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('upload')
    .helpGroup('Project workflow:')
    .description('Upload and deploy local files to an upload app')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--msg <message>', 'Deploy message')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            msg?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runUploadCommand({
                app: options.app,
                server: options.server,
                msg: options.msg,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('releases')
    .helpGroup('Project workflow:')
    .description('List deploy/release history for an app')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runReleasesCommand({
                app: options.app,
                server: options.server,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('status')
    .helpGroup('Project workflow:')
    .description('Show app status using auto project resolution')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runStatusCommand({
                app: options.app,
                server: options.server,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('link')
    .helpGroup('Project workflow:')
    .description('Link current project directory to a Ramp app')
    .option('--app <stack>', 'Override stack name instead of reading ramp.yaml')
    .option(
        '--server <name>',
        'Filter by server name when multiple matches exist',
    )
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runLinkCommand({
                app: options.app,
                server: options.server,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program.commandsGroup('Account & access:');

program
    .command('login')
    .helpGroup('Getting started:')
    .description('Open the browser, approve this device, and store a CLI token')
    .option('--email <email>', 'Email address for login')
    .option('--device-name <name>', 'Override the device name shown for this CLI session')
    .option('--token <token>', 'Use an existing API token directly')
    .option(
        '--api-url <url>',
        'Ramp API base URL',
        process.env.RAMP_API_URL ?? 'http://127.0.0.1:8000',
    )
    .action(
        async (options: {
            email?: string;
            deviceName?: string;
            token?: string;
            apiUrl?: string;
        }) => {
            const code = await runLoginCommand({
                email: options.email,
                deviceName: options.deviceName,
                token: options.token,
                apiUrl:
                    options.apiUrl ??
                    process.env.RAMP_API_URL ??
                    'http://127.0.0.1:8000',
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('mcp:login')
    .description('Show MCP web connection details for current CLI token')
    .helpGroup('AI & MCP:')
    .option('--json', 'Output JSON result')
    .option('--token-only', 'Print only the bearer token')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            json?: boolean;
            tokenOnly?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runMcpLoginCommand({
                json: options.json === true,
                tokenOnly: options.tokenOnly === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('mcp:cursor')
    .description('Print a ready-to-paste MCP config snippet')
    .helpGroup('AI & MCP:')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(async (options: { json?: boolean; apiUrl?: string }) => {
        const code = await runMcpCursorCommand({
            json: options.json === true,
            apiUrl: options.apiUrl,
            ...globals(),
        });

        process.exitCode = code;
    });

program
    .command('deploy')
    .description('Trigger deploy using auto project resolution')
    .helpGroup('Project workflow:')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--no-git-check', 'Skip local git state confirmation before deploy')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            gitCheck?: boolean;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runDeployCommand({
                app: options.app,
                server: options.server,
                gitCheck: options.gitCheck !== false,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('rollback')
    .description(
        'Rollback app to latest successful deploy or specific deploy id',
    )
    .helpGroup('Project workflow:')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--deploy-id <id>', 'Target successful deploy id')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            deployId?: string;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runRollbackCommand({
                app: options.app,
                server: options.server,
                deployId: options.deployId,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('db:backup')
    .description('Create a database backup or list available backups')
    .helpGroup('Project workflow:')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--list', 'List backups')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            list?: boolean;
            json?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runDbBackupCommand({
                app: options.app,
                server: options.server,
                list: options.list === true,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('db:restore [backupId]')
    .description('Restore a database backup')
    .helpGroup('Project workflow:')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--latest', 'Restore latest backup')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            backupId: string | undefined,
            options: {
                app?: string;
                server?: string;
                latest?: boolean;
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runDbRestoreCommand({
                app: options.app,
                server: options.server,
                backupId,
                latest: options.latest === true,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('unlink')
    .description('Remove local Ramp project link (.ramp/config.json)')
    .helpGroup('Project workflow:')
    .option('--json', 'Output JSON result')
    .action(async (options: { json?: boolean }) => {
        const code = await runUnlinkCommand({
            json: options.json === true,
            ...globals(),
        });

        process.exitCode = code;
    });

program
    .command('workspace [workspace]')
    .description('List workspaces or switch the current workspace')
    .helpGroup('Account & access:')
    .option('--json', 'Output JSON result')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (
            workspace: string | undefined,
            options: {
                json?: boolean;
                apiUrl?: string;
            },
        ) => {
            const code = await runWorkspaceCommand({
                workspace,
                json: options.json === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('whoami')
    .description('Show current logged in user')
    .helpGroup('Account & access:')
    .option('--json', 'Output JSON result')
    .option('--show-token', 'Print stored bearer token details')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            json?: boolean;
            showToken?: boolean;
            apiUrl?: string;
        }) => {
            const code = await runWhoAmICommand({
                json: options.json === true,
                showToken: options.showToken === true,
                apiUrl: options.apiUrl,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('logout')
    .description('Revoke current CLI token and clear local credentials')
    .helpGroup('Account & access:')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(async (options: { apiUrl?: string }) => {
        const code = await runLogoutCommand({
            apiUrl: options.apiUrl,
            ...globals(),
        });

        process.exitCode = code;
    });

program
    .command('validate [file]')
    .description('Validate a ramp.yaml file using remote API validation')
    .helpGroup('Getting started:')
    .option('--json', 'Output JSON result')
    .option('--strict', 'Treat warnings as errors')
    .option(
        '--server <id-or-name>',
        'Validate with server context for collision checks',
    )
    .option(
        '--api-url <url>',
        'Ramp API base URL',
        process.env.RAMP_API_URL ?? 'http://127.0.0.1:8000',
    )
    .action(
        async (
            file: string | undefined,
            options: {
                json?: boolean;
                strict?: boolean;
                server?: string;
                apiUrl?: string;
            },
        ) => {
            const code = await runValidateCommand({
                file,
                server: options.server,
                json: options.json === true,
                strict: options.strict === true,
                apiUrl:
                    options.apiUrl ??
                    process.env.RAMP_API_URL ??
                    'http://127.0.0.1:8000',
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program.commandsGroup('AI & MCP:');

program
    .command('claude')
    .helpGroup('AI & MCP:')
    .description('Open Claude Code on your server via SSH')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--identity <path>', 'Path to SSH private key')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            identity?: string;
            apiUrl?: string;
        }) => {
            const code = await runAiBridgeCommand({
                tool: 'claude',
                app: options.app,
                server: options.server,
                identity: options.identity,
                apiUrl: options.apiUrl,
                json: false,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('codex')
    .helpGroup('AI & MCP:')
    .description('Open Codex on your server via SSH')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--identity <path>', 'Path to SSH private key')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            identity?: string;
            apiUrl?: string;
        }) => {
            const code = await runAiBridgeCommand({
                tool: 'codex',
                app: options.app,
                server: options.server,
                identity: options.identity,
                apiUrl: options.apiUrl,
                json: false,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('opencode')
    .helpGroup('AI & MCP:')
    .description('Open OpenCode on your server via SSH')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--identity <path>', 'Path to SSH private key')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            identity?: string;
            apiUrl?: string;
        }) => {
            const code = await runAiBridgeCommand({
                tool: 'opencode',
                app: options.app,
                server: options.server,
                identity: options.identity,
                apiUrl: options.apiUrl,
                json: false,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

program
    .command('gemini')
    .helpGroup('AI & MCP:')
    .description('Open Gemini CLI on your server via SSH')
    .option('--app <stack>', 'Override stack name')
    .option('--server <name>', 'Filter by server name')
    .option('--identity <path>', 'Path to SSH private key')
    .option('--api-url <url>', 'Ramp API base URL')
    .action(
        async (options: {
            app?: string;
            server?: string;
            identity?: string;
            apiUrl?: string;
        }) => {
            const code = await runAiBridgeCommand({
                tool: 'gemini',
                app: options.app,
                server: options.server,
                identity: options.identity,
                apiUrl: options.apiUrl,
                json: false,
                ...globals(),
            });

            process.exitCode = code;
        },
    );

await program.parseAsync(process.argv);
