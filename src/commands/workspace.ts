import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import {
  ensureSelectedWorkspaceId,
  readCredentials,
  saveCredentials,
  type StoredCredentials,
} from '../lib/auth-store.js';
import { selectWithArrows } from '../lib/select.js';
import { appHeader, badge, box, isInteractiveUi, keyHint, paint, statusLine } from '../lib/ui.js';

type WorkspaceCommandOptions = {
  workspace?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type WorkspaceItem = {
  id: string;
  name: string;
  is_personal?: boolean;
  is_current?: boolean;
  role?: string | null;
  plan?: string | null;
};

type WorkspaceListResponse = {
  data?: WorkspaceItem[];
};

type WorkspaceSwitchResponse = {
  data?: WorkspaceItem;
};

export async function runWorkspaceCommand(options: WorkspaceCommandOptions): Promise<number> {
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
  const workspacesResult = await fetchWorkspaces(apiUrl, resolvedCredentials);

  if (workspacesResult.error !== null) {
    process.stderr.write(`${statusLine('error', workspacesResult.error)}\n`);
    return 1;
  }

  const workspaces = workspacesResult.data;
  const currentWorkspace = workspaces.find((workspace) => workspace.is_current === true) ?? null;

  if (options.workspace && options.workspace.trim() !== '') {
    const targetWorkspace = findWorkspace(workspaces, options.workspace.trim());

    if (targetWorkspace === null) {
      process.stderr.write(
        `${statusLine('error', `Workspace '${options.workspace.trim()}' not found.`)}\n`,
      );
      return 1;
    }

    return switchWorkspace({
      apiUrl,
      credentials: resolvedCredentials,
      workspace: targetWorkspace,
      currentWorkspace,
      json: options.json,
      quiet: options.quiet,
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data: workspaces }, null, 2)}\n`);
    return 0;
  }

  if (workspaces.length === 0) {
    if (!options.quiet) {
      process.stdout.write(`${statusLine('info', 'No workspaces available.')}\n`);
    }

    return 0;
  }

  if (workspaces.length === 1) {
    const onlyWorkspace = workspaces[0];

    if (onlyWorkspace.is_current === true) {
      if (!options.quiet) {
        process.stdout.write(
          `${box([
            statusLine('success', `Current workspace: ${paint(onlyWorkspace.name, 'bold')}`),
            keyHint(formatWorkspaceMeta(onlyWorkspace)),
          ])}\n`,
        );
      }

      return 0;
    }

    return switchWorkspace({
      apiUrl,
      credentials: resolvedCredentials,
      workspace: onlyWorkspace,
      currentWorkspace,
      json: false,
      quiet: options.quiet,
    });
  }

  if (!process.stdin.isTTY || !isInteractiveUi()) {
    if (!options.quiet) {
      process.stdout.write(
        `${appHeader(
          'Ramp',
          'Workspaces',
          'Pass a workspace id or name to switch in non-interactive shells.',
        )}\n\n`,
      );
      process.stdout.write(
        `${box(workspaces.map((workspace) => formatWorkspaceLine(workspace)))}\n`,
      );
      process.stdout.write(`${keyHint('Use `ramp workspace <workspace>` to switch.')}\n`);
    }

    return 0;
  }

  const selectedWorkspace = await selectWithArrows(
    'Select workspace',
    workspaces.map((workspace) => ({
      label: formatWorkspaceLine(workspace),
      value: workspace,
    })),
  );

  if (selectedWorkspace === null) {
    process.stderr.write(`${statusLine('error', 'Cancelled.')}\n`);
    return 130;
  }

  return switchWorkspace({
    apiUrl,
    credentials: resolvedCredentials,
    workspace: selectedWorkspace,
    currentWorkspace,
    json: false,
    quiet: options.quiet,
  });
}

async function fetchWorkspaces(
  apiUrl: string,
  credentials: StoredCredentials,
): Promise<{ data: WorkspaceItem[]; error: string | null }> {
  try {
    const response = await fetch(buildApiV1Endpoint(apiUrl, '/workspaces'), {
      headers: buildApiHeaders({
        token: credentials.token,
        selectedWorkspaceId: credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      return {
        data: [],
        error: await describeApiError(response, 'Failed to list workspaces'),
      };
    }

    const payload = (await response.json()) as WorkspaceListResponse;

    return {
      data: Array.isArray(payload.data) ? payload.data : [],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      data: [],
      error: `Failed to list workspaces: ${message}`,
    };
  }
}

async function switchWorkspace(input: {
  apiUrl: string;
  credentials: StoredCredentials;
  workspace: WorkspaceItem;
  currentWorkspace: WorkspaceItem | null;
  json: boolean;
  quiet: boolean;
}): Promise<number> {
  if (input.workspace.is_current === true) {
    if (input.json) {
      process.stdout.write(`${JSON.stringify({ data: input.workspace }, null, 2)}\n`);
    } else if (!input.quiet) {
      process.stdout.write(
        `${box([
          statusLine('success', `Current workspace: ${paint(input.workspace.name, 'bold')}`),
          keyHint(formatWorkspaceMeta(input.workspace)),
        ])}\n`,
      );
    }

    return 0;
  }

  let payload: WorkspaceSwitchResponse;

  try {
    const response = await fetch(
      buildApiV1Endpoint(input.apiUrl, `/workspaces/${input.workspace.id}/switch`),
      {
        method: 'POST',
        headers: buildApiHeaders({
          token: input.credentials.token,
          selectedWorkspaceId: input.credentials.selectedWorkspaceId,
        }),
      },
    );

    if (!response.ok) {
      process.stderr.write(
        `${statusLine('error', await describeApiError(response, 'Failed to switch workspace'))}\n`,
      );
      return 1;
    }

    payload = (await response.json()) as WorkspaceSwitchResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    process.stderr.write(`${statusLine('error', `Failed to switch workspace: ${message}`)}\n`);
    return 1;
  }

  const switchedWorkspace = payload.data ?? input.workspace;

  await saveCredentials({
    ...input.credentials,
    selectedWorkspaceId: switchedWorkspace.id,
    updatedAt: new Date().toISOString(),
  });

  if (input.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!input.quiet) {
    const previousWorkspace =
      input.currentWorkspace && input.currentWorkspace.name !== ''
        ? input.currentWorkspace.name
        : 'none';

    process.stdout.write(
      `${box([
        statusLine('success', `Current workspace: ${paint(switchedWorkspace.name, 'bold')}`),
        keyHint(`Previous: ${previousWorkspace}`),
        keyHint(formatWorkspaceMeta(switchedWorkspace)),
      ])}\n`,
    );
  }

  return 0;
}

function findWorkspace(workspaces: WorkspaceItem[], input: string): WorkspaceItem | null {
  const normalized = input.trim().toLowerCase();

  return (
    workspaces.find((workspace) => workspace.id === input) ??
    workspaces.find((workspace) => workspace.name.trim().toLowerCase() === normalized) ??
    null
  );
}

function formatWorkspaceLine(workspace: WorkspaceItem): string {
  const current = workspace.is_current === true ? badge('current', 'success') : '';
  const kind = workspace.is_personal === true ? 'personal' : 'team';
  const role = workspace.role ? workspace.role : kind;
  const plan = workspace.plan ? workspace.plan : 'no plan';

  return (
    `${paint(workspace.name, 'bold')} ${current}`.trimEnd() +
    `  ${paint(role, 'gray')}  ${paint(plan, 'gray')}`
  );
}

function formatWorkspaceMeta(workspace: WorkspaceItem): string {
  const kind = workspace.is_personal === true ? 'personal' : 'team';
  const role = workspace.role ? workspace.role : kind;
  const plan = workspace.plan ? workspace.plan : 'no plan';

  return `Role: ${role}  |  Plan: ${plan}`;
}
