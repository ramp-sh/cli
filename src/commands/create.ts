import { readFile, access, unlink, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseDocument } from 'yaml';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { askOrCancel, wireSigintToClose } from '../lib/prompt.js';
import {
  ensureSelectedWorkspaceId,
  readCredentials,
  type StoredCredentials,
} from '../lib/auth-store.js';
import { writeProjectLink } from '../lib/project-link.js';
import { selectWithArrows } from '../lib/select.js';
import { findConfigFile } from '../lib/find-config-file.js';
import { ensureLocalOctaneReady } from '../lib/octane-preflight.js';
import { createProjectArchive } from '../lib/archive.js';
import { formatFileSize } from '../lib/format-size.js';
import {
  box,
  isInteractiveUi,
  keyHint,
  paint,
  sectionHeader,
  stepper,
  statusLine,
} from '../lib/ui.js';

type CreateCommandOptions = {
  server?: string;
  name?: string;
  source?: string;
  repository?: string;
  branch?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type ServerItem = {
  id: string;
  name: string;
  status: string;
  cloud_provider_name?: string | null;
};
type PortConflictHint = {
  currentPort: string;
  serviceName: string;
  conflictingService: string;
  suggestedPort: string;
};
type CreateUploadResponse = {
  ok?: boolean;
  message?: string;
  errors?: string[] | Record<string, string[]>;
  deploy_queued?: boolean;
  app?: {
    id: string;
    stack: string;
    deploy_mode: string;
    server?: { id?: string; name?: string };
    status: string;
  };
};

export async function runCreateCommand(options: CreateCommandOptions): Promise<number> {
  const credentials = await readCredentials();

  if (credentials === null) {
    process.stderr.write(`${statusLine('error', 'Not logged in. Run `ramp login` first.')}\n`);
    return 1;
  }

  const resolvedCredentials = await ensureSelectedWorkspaceId({
    ...credentials,
    apiUrl: options.apiUrl ?? credentials.apiUrl,
  });
  const apiUrl = resolvedCredentials.apiUrl;
  const servers = await listServers(apiUrl, resolvedCredentials);

  if (servers.error) {
    process.stderr.write(`${statusLine('error', servers.error)}\n`);
    return 1;
  }

  const activeServers = servers.data.filter((server) => server.status === 'active');

  if (activeServers.length === 0) {
    process.stderr.write(
      `${statusLine('error', 'No active servers available. Wait for provisioning to finish or create a server first.')}\n`,
    );
    return 1;
  }

  const sourceType = await resolveSourceType(options);

  if (sourceType === null) {
    process.stderr.write(`${statusLine('error', 'Cancelled.')}\n`);
    return 130;
  }

  if (isInteractiveUi() && !options.quiet && !options.json) {
    const sourceLabel = sourceType === 'upload' ? 'Local upload' : 'GitHub repo';
    process.stdout.write(
      `${sectionHeader('Create and link an app', `Source: ${sourceLabel}`)}\n\n`,
    );
    process.stdout.write(
      `${stepper('Flow', [
        { label: 'Choose server', state: 'current' },
        { label: 'Set app details', state: 'pending' },
        { label: 'Create and link', state: 'pending' },
      ])}\n\n`,
    );
  }

  const selectedServer = await resolveServer(options.server, activeServers, servers.data);

  if (selectedServer === null) {
    process.stderr.write(`${statusLine('error', 'No server selected.')}\n`);
    return 1;
  }

  if (typeof selectedServer === 'string') {
    process.stderr.write(`${statusLine('error', selectedServer)}\n`);
    return 1;
  }

  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  stdin.resume();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  wireSigintToClose(rl);

  try {
    if (sourceType === 'upload') {
      return createUploadApp(options, rl, apiUrl, resolvedCredentials, selectedServer);
    }

    return createRepoApp(options, rl, apiUrl, resolvedCredentials, selectedServer);
  } finally {
    rl.close();
  }
}

async function resolveSourceType(options: CreateCommandOptions): Promise<'repo' | 'upload' | null> {
  // Explicit flag
  if (options.source === 'repo') return 'repo';
  if (options.source === 'upload') return 'upload';

  // Non-interactive: default based on context
  if (!process.stdin.isTTY || options.json) {
    const hasGit = await fileExists(path.join(process.cwd(), '.git'));
    return hasGit ? 'repo' : 'upload';
  }

  // Interactive: detect and suggest
  const hasGit = await fileExists(path.join(process.cwd(), '.git'));
  const hasConfig = (await findConfigFile()) !== null;

  // Smart default: .git → repo, ramp.yaml without .git → upload
  const defaultSource = hasGit ? 'repo' : hasConfig ? 'upload' : 'repo';

  const selected = await selectWithArrows('App source', [
    {
      label: 'GitHub repo',
      description: 'Deploy from a Git repository',
      value: 'repo' as const,
    },
    {
      label: 'Local upload',
      description: 'Deploy from local files (no Git needed)',
      value: 'upload' as const,
    },
  ]);

  return selected ?? defaultSource;
}

async function createUploadApp(
  options: CreateCommandOptions,
  rl: readline.Interface,
  apiUrl: string,
  credentials: StoredCredentials,
  server: ServerItem,
): Promise<number> {
  // Read stack name from ramp.yaml, let user confirm or override
  let name = options.name;

  if (!name) {
    let detectedName: string | null = null;
    const configPath = await findConfigFile();

    if (configPath) {
      const yaml = await readFile(configPath, 'utf8');
      const stackMatch = yaml.match(/^stack:\s*(.+)/m);

      if (stackMatch) {
        detectedName = stackMatch[1].trim();
      }
    }

    if (detectedName && process.stdin.isTTY && !options.json) {
      const input = await askOrCancel(rl, `App name [${detectedName}]: `);

      if (input === null) return 130;
      name = input.trim() || detectedName;
    } else if (detectedName) {
      name = detectedName;
    } else {
      const input = await askOrCancel(rl, 'App name: ');

      if (input === null) return 130;
      name = input.trim();
    }
  }

  if (name === '') {
    process.stderr.write(`${statusLine('error', 'App name is required.')}\n`);
    return 1;
  }

  const deployNow = await shouldDeployNow(options, rl);

  if (deployNow === null) {
    return 130;
  }

  if (deployNow) {
    const octaneReadiness = await ensureLocalOctaneReady();

    if (!octaneReadiness.ok) {
      process.stderr.write(`${statusLine('error', octaneReadiness.message)}\n`);

      for (const detail of octaneReadiness.details) {
        process.stderr.write(`${paint('·', 'red', 'stderr')} ${detail}\n`);
      }

      return 1;
    }
  }

  if (!options.quiet && !options.json) {
    process.stdout.write(
      `${statusLine('info', deployNow ? 'Packaging project...' : 'Preparing app bundle...')}\n`,
    );
  }

  // Create archive
  const projectRoot = process.cwd();
  const { archivePath, error: archiveError } = await createProjectArchive(projectRoot);

  if (archiveError) {
    process.stderr.write(`${statusLine('error', archiveError)}\n`);

    if (archivePath) {
      await unlink(archivePath).catch(() => {});
    }

    return 1;
  }

  const archiveStat = await stat(archivePath);
  const archiveSize = formatFileSize(archiveStat.size);

  if (!options.quiet && !options.json) {
    process.stdout.write(
      `${statusLine('info', `Archive: ${archiveSize}. ${deployNow ? 'Uploading...' : 'Sending app blueprint...'}`)}\n`,
    );
  }

  // Upload via multipart form
  const archiveBuffer = await readFile(archivePath);
  const blob = new Blob([archiveBuffer], { type: 'application/gzip' });

  const formData = new FormData();
  formData.append('archive', blob, path.basename(archivePath));
  formData.append('app_name', name);
  formData.append('deploy_now', deployNow ? '1' : '0');

  // Clean up local archive
  await unlink(archivePath).catch(() => {});

  const response = await fetch(buildApiV1Endpoint(apiUrl, `/servers/${server.id}/apps/upload`), {
    method: 'POST',
    headers: buildApiHeaders({
      token: credentials.token,
      selectedWorkspaceId: credentials.selectedWorkspaceId,
    }),
    body: formData,
  });

  const payload = (await response.json()) as CreateUploadResponse;

  if (!response.ok || payload.ok !== true || !payload.app) {
    const errorMessages = extractErrors(payload.errors, payload.message, response.status);
    process.stderr.write(`${statusLine('error', 'Failed to create app:')}\n`);

    for (const error of errorMessages) {
      process.stderr.write(`${paint('·', 'red', 'stderr')} ${error}\n`);
    }

    await offerPortConflictFix(errorMessages, options, rl);

    return 1;
  }

  const linkPath = await writeProjectLink(process.cwd(), {
    app_id: payload.app.id,
    server_id: payload.app.server?.id ?? server.id,
    stack: payload.app.stack,
    linked_at: new Date().toISOString(),
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, app: payload.app, linked: linkPath, deploy_queued: payload.deploy_queued === true }, null, 2)}\n`,
    );
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(
      `${box([
        statusLine(
          'success',
          `Created upload app ${paint(payload.app.stack, 'bold')} on ${paint(server.name, 'bold')}.`,
        ),
        statusLine('info', `Linked current directory: ${paint(linkPath, 'bold')}`),
        payload.deploy_queued === true
          ? keyHint('Initial deploy queued. Deploy again anytime with `ramp upload`')
          : keyHint('Run `ramp upload` when you are ready to deploy'),
      ])}\n`,
    );
  }

  return 0;
}

async function shouldDeployNow(
  options: CreateCommandOptions,
  rl: readline.Interface,
): Promise<boolean | null> {
  if (!process.stdin.isTTY || options.json) {
    return true;
  }

  const answer = await askOrCancel(rl, 'Deploy now? [Y/n]: ');

  if (answer === null) {
    return null;
  }

  const normalized = answer.trim().toLowerCase();

  if (normalized === '' || normalized === 'y' || normalized === 'yes') {
    return true;
  }

  return false;
}

async function offerPortConflictFix(
  errorMessages: string[],
  options: CreateCommandOptions,
  rl: readline.Interface,
): Promise<void> {
  if (options.json || !process.stdin.isTTY) {
    return;
  }

  const hint = detectPortConflict(errorMessages);

  if (hint === null) {
    return;
  }

  const configPath = await findConfigFile();

  if (configPath === null) {
    return;
  }

  const answer = await askOrCancel(
    rl,
    `Port ${hint.currentPort} is already used by ${hint.conflictingService}. Update ramp.yaml ${hint.serviceName}.port to ${hint.suggestedPort}? [Y/n]: `,
  );

  if (answer === null) {
    return;
  }

  const normalized = answer.trim().toLowerCase();

  if (normalized !== '' && normalized !== 'y' && normalized !== 'yes') {
    return;
  }

  const updateResult = await updateServicePortInConfig(
    configPath,
    hint.serviceName,
    hint.currentPort,
    hint.suggestedPort,
  );

  if (!updateResult.ok) {
    process.stderr.write(`${statusLine('warning', updateResult.error)}\n`);
    return;
  }

  process.stdout.write(
    `${statusLine('success', buildPortFixMessage(configPath, hint.serviceName, hint.suggestedPort, updateResult.updatedStartCommand === true, updateResult.updatedEnvPort === true))}\n`,
  );
  process.stdout.write(
    `${statusLine('info', 'Re-run `ramp create --source upload` to try again.')}\n`,
  );
}

function detectPortConflict(errorMessages: string[]): PortConflictHint | null {
  for (const errorMessage of errorMessages) {
    const match = errorMessage.match(
      /^Port (\d+) \(service ['"]?([^'")]+)['"]?\) is already in use by ['"]?(.+?)['"]? on this server\. Try port (\d+)\.$/,
    );

    if (match) {
      const [, currentPort, serviceName, conflictingService, suggestedPort] = match;

      return {
        currentPort,
        serviceName,
        conflictingService,
        suggestedPort,
      };
    }
  }

  return null;
}

async function updateServicePortInConfig(
  configPath: string,
  serviceName: string,
  currentPort: string,
  suggestedPort: string,
): Promise<
  | {
      ok: true;
      updatedStartCommand: boolean;
      updatedEnvPort: boolean;
    }
  | { ok: false; error: string }
> {
  const yaml = await readFile(configPath, 'utf8');
  const document = parseDocument(yaml);

  if (document.errors.length > 0) {
    return {
      ok: false,
      error: `Could not update ${path.basename(configPath)} because it is not valid YAML.`,
    };
  }

  const serviceNode = document.getIn(['services', serviceName], true);

  if (serviceNode === undefined) {
    return {
      ok: false,
      error: `Could not find services.${serviceName} in ${path.basename(configPath)}.`,
    };
  }

  const port = Number.parseInt(suggestedPort, 10);

  if (Number.isNaN(port)) {
    return {
      ok: false,
      error: `Suggested port "${suggestedPort}" is invalid.`,
    };
  }

  document.setIn(['services', serviceName, 'port'], port);

  const startCommand = document.getIn(['services', serviceName, 'start']) as unknown;
  let updatedStartCommand = false;

  if (typeof startCommand === 'string') {
    const nextStartCommand = rewriteCommandPort(startCommand, currentPort, suggestedPort);

    if (nextStartCommand !== startCommand) {
      document.setIn(['services', serviceName, 'start'], nextStartCommand);
      updatedStartCommand = true;
    }
  }

  const envPort = document.getIn(['services', serviceName, 'env', 'PORT']) as unknown;
  let updatedEnvPort = false;

  if (typeof envPort === 'string' && envPort === currentPort) {
    document.setIn(['services', serviceName, 'env', 'PORT'], suggestedPort);
    updatedEnvPort = true;
  }

  const nextYaml = document.toString().replace(/\s*$/, '\n');
  await writeFile(configPath, nextYaml, 'utf8');

  return { ok: true, updatedStartCommand, updatedEnvPort };
}

function rewriteCommandPort(command: string, currentPort: string, suggestedPort: string): string {
  const patterns = [
    new RegExp(`(--port=)${escapeRegExp(currentPort)}(?=\\b)`, 'g'),
    new RegExp(`(--port\\s+)${escapeRegExp(currentPort)}(?=\\b)`, 'g'),
    new RegExp(`(-p\\s+)${escapeRegExp(currentPort)}(?=\\b)`, 'g'),
  ];

  let nextCommand = command;

  for (const pattern of patterns) {
    nextCommand = nextCommand.replace(pattern, `$1${suggestedPort}`);
  }

  return nextCommand;
}

function buildPortFixMessage(
  configPath: string,
  serviceName: string,
  suggestedPort: string,
  updatedStartCommand: boolean,
  updatedEnvPort: boolean,
): string {
  if (updatedStartCommand && updatedEnvPort) {
    return `Updated ${path.basename(configPath)}: services.${serviceName}.port = ${suggestedPort}, synced the start command port, and updated env.PORT.`;
  }

  if (updatedStartCommand) {
    return `Updated ${path.basename(configPath)}: services.${serviceName}.port = ${suggestedPort} and synced the start command port.`;
  }

  if (updatedEnvPort) {
    return `Updated ${path.basename(configPath)}: services.${serviceName}.port = ${suggestedPort} and updated env.PORT.`;
  }

  return `Updated ${path.basename(configPath)}: services.${serviceName}.port = ${suggestedPort}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createRepoApp(
  options: CreateCommandOptions,
  rl: readline.Interface,
  apiUrl: string,
  credentials: StoredCredentials,
  server: ServerItem,
): Promise<number> {
  const nameInput = options.name ?? (await askOrCancel(rl, 'App name (stack): '));
  const repositoryInput =
    options.repository ?? (await askOrCancel(rl, 'Repository (owner/repo): '));
  const branchInput = options.branch ?? (await askOrCancel(rl, 'Branch [main]: '));

  if (nameInput === null || repositoryInput === null || branchInput === null) {
    process.stderr.write(`${statusLine('error', 'Cancelled.')}\n`);
    return 130;
  }

  const name = nameInput.trim();
  const repository = repositoryInput.trim();
  const branch = branchInput.trim() || 'main';

  if (name === '' || repository === '') {
    process.stderr.write(`${statusLine('error', 'App name and repository are required.')}\n`);
    return 1;
  }

  const response = await fetch(buildApiV1Endpoint(apiUrl, `/servers/${server.id}/apps`), {
    method: 'POST',
    headers: buildApiHeaders({
      token: credentials.token,
      selectedWorkspaceId: credentials.selectedWorkspaceId,
      contentType: 'application/json',
    }),
    body: JSON.stringify({
      app_name: name,
      repository,
      branch,
    }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    message?: string;
    errors?: string[] | Record<string, string[]>;
    app?: {
      id: string;
      stack: string;
      server?: { id?: string; name?: string };
    };
  };

  if (!response.ok || payload.ok !== true || !payload.app) {
    const errorMessages = extractErrors(payload.errors, payload.message, response.status);
    process.stderr.write(`${statusLine('error', 'Failed to create app:')}\n`);

    for (const error of errorMessages) {
      process.stderr.write(`${paint('·', 'red', 'stderr')} ${error}\n`);
    }

    return 1;
  }

  const linkPath = await writeProjectLink(process.cwd(), {
    app_id: payload.app.id,
    server_id: payload.app.server?.id ?? server.id,
    stack: payload.app.stack,
    linked_at: new Date().toISOString(),
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, app: payload.app, linked: linkPath }, null, 2)}\n`,
    );
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(
      `${box([
        statusLine(
          'success',
          `Created app ${paint(payload.app.stack, 'bold')} on ${paint(server.name, 'bold')}.`,
        ),
        keyHint(`Repository ${repository}  |  branch ${branch}`),
        statusLine('info', `Linked current directory: ${paint(linkPath, 'bold')}`),
      ])}\n`,
    );
  }

  return 0;
}

async function listServers(
  apiUrl: string,
  credentials: StoredCredentials,
): Promise<{ data: ServerItem[]; error: string | null }> {
  try {
    const response = await fetch(buildApiV1Endpoint(apiUrl, '/servers'), {
      headers: buildApiHeaders({
        token: credentials.token,
        selectedWorkspaceId: credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      return {
        data: [],
        error: await describeApiError(response, 'Failed to list servers'),
      };
    }

    const payload = (await response.json()) as { data?: ServerItem[] };

    return {
      data: Array.isArray(payload.data) ? payload.data : [],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return { data: [], error: `Failed to list servers: ${message}` };
  }
}

async function resolveServer(
  input: string | undefined,
  servers: ServerItem[],
  allServers: ServerItem[],
): Promise<ServerItem | string | null> {
  if (typeof input === 'string' && input.trim() !== '') {
    const needle = input.trim();
    const matchServer = (server: ServerItem) => server.id === needle || server.name === needle;

    const activeServer = servers.find(matchServer);

    if (activeServer) {
      return activeServer;
    }

    if (allServers.find(matchServer)) {
      return `Server '${needle}' is not active yet.`;
    }

    return null;
  }

  return selectWithArrows(
    'Select server',
    servers.map((server) => ({
      label: formatServerChoice(server),
      value: server,
    })),
  );
}

function formatServerChoice(server: ServerItem): string {
  if (!server.cloud_provider_name) {
    return server.name;
  }

  return `${server.name}  ${paint(`(${server.cloud_provider_name})`, 'gray')}`;
}

/**
 * Normalize error responses from the API.
 *
 * Laravel validation returns `{ message, errors: { field: ["msg"] } }` (object).
 * Our action returns `{ ok: false, errors: ["msg"] }` (array).
 * Handle both shapes gracefully.
 */
function extractErrors(
  errors: string[] | Record<string, string[]> | undefined,
  message: string | undefined,
  status: number,
): string[] {
  if (Array.isArray(errors)) {
    return errors;
  }

  if (errors && typeof errors === 'object') {
    // Laravel validation error shape: { field: ["msg1", "msg2"] }
    return Object.values(errors).flat();
  }

  if (message) {
    return [message];
  }

  return [`HTTP ${status}`];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
