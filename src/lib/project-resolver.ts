import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseDocument } from 'yaml';
import { buildApiV1Endpoint } from './api-url.js';
import { buildApiHeaders } from './api-headers.js';
import { describeApiError } from './api-errors.js';
import {
  ensureSelectedWorkspaceId,
  readCredentials,
  type StoredCredentials,
} from './auth-store.js';
import { findConfigFile } from './find-config-file.js';
import { selectWithArrows } from './select.js';
import { readProjectLink, type LinkedProject, writeProjectLink } from './project-link.js';

export type AppMatch = {
  id: string;
  workspace_id: string;
  stack: string;
  status: string;
  server?: {
    id?: string;
    name?: string;
  };
};

type AppsResponse = { data?: AppMatch[] };
type AppShowResponse = { data?: AppMatch };

export type ResolvedProjectContext = {
  token: string;
  apiUrl: string;
  selectedWorkspaceId?: string;
  app: AppMatch;
  source: 'flag' | 'link' | 'stack';
};

type ResolveInput = {
  apiUrl?: string;
  app?: string;
  server?: string;
  json: boolean;
};

export async function resolveProjectContext(
  input: ResolveInput,
): Promise<{ context: ResolvedProjectContext | null; error: string | null }> {
  const credentials = await readCredentials();

  if (credentials === null) {
    return {
      context: null,
      error: 'Not logged in. Run `ramp login` first.',
    };
  }

  const resolvedCredentials = await ensureSelectedWorkspaceId({
    ...credentials,
    apiUrl: input.apiUrl ?? credentials.apiUrl,
  });
  const apiUrl = resolvedCredentials.apiUrl;

  if (input.app) {
    const selected = await resolveByStack({
      credentials: resolvedCredentials,
      apiUrl,
      stack: input.app,
      server: input.server,
      json: input.json,
      persistOnDisambiguation: false,
    });

    if (selected.error) {
      return { context: null, error: selected.error };
    }

    return {
      context: {
        token: resolvedCredentials.token,
        apiUrl,
        selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
        app: selected.app as AppMatch,
        source: 'flag',
      },
      error: null,
    };
  }

  const link = await readProjectLink();

  if (link !== null) {
    const linkedApp = await getAppById({
      apiUrl,
      credentials: resolvedCredentials,
      appId: link.value.app_id,
    });

    if (linkedApp.error !== null) {
      return {
        context: null,
        error: linkedApp.error,
      };
    }

    if (linkedApp.app !== null) {
      const mismatchError = linkedAppWorkspaceMismatchError(resolvedCredentials, linkedApp.app);

      if (mismatchError !== null) {
        return {
          context: null,
          error: mismatchError,
        };
      }

      return {
        context: {
          token: resolvedCredentials.token,
          apiUrl,
          selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
          app: linkedApp.app,
          source: 'link',
        },
        error: null,
      };
    }
  }

  const configFilePath = await findConfigFile();

  if (configFilePath === null) {
    return {
      context: null,
      error: 'No ramp.yaml found in current directory or parent directories.',
    };
  }

  const stack = await readStackFromConfigFile(configFilePath);

  if (stack === null) {
    return {
      context: null,
      error: 'Unable to determine `stack` from ramp.yaml.',
    };
  }

  const selected = await resolveByStack({
    credentials: resolvedCredentials,
    apiUrl,
    stack,
    server: input.server,
    json: input.json,
    persistOnDisambiguation: true,
    configPath: configFilePath,
  });

  if (selected.error) {
    return { context: null, error: selected.error };
  }

  return {
    context: {
      token: resolvedCredentials.token,
      apiUrl,
      selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
      app: selected.app as AppMatch,
      source: 'stack',
    },
    error: null,
  };
}

async function resolveByStack(input: {
  credentials: StoredCredentials;
  apiUrl: string;
  stack: string;
  server?: string;
  json: boolean;
  persistOnDisambiguation: boolean;
  configPath?: string;
}): Promise<{ app: AppMatch | null; error: string | null }> {
  const lookup = await lookupAppsByStack({
    apiUrl: input.apiUrl,
    credentials: input.credentials,
    stack: input.stack,
    server: input.server,
  });

  if (lookup.error !== null) {
    return { app: null, error: lookup.error };
  }

  if (lookup.apps.length === 0) {
    return {
      app: null,
      error: `No app found for stack '${input.stack}'.`,
    };
  }

  if (lookup.apps.length === 1) {
    if (input.persistOnDisambiguation && input.configPath) {
      const projectRoot = path.dirname(input.configPath);
      const match = lookup.apps[0];

      const linkData: LinkedProject = {
        app_id: match.id,
        server_id: match.server?.id ?? null,
        stack: match.stack,
        linked_at: new Date().toISOString(),
      };

      await writeProjectLink(projectRoot, linkData);
    }

    return { app: lookup.apps[0], error: null };
  }

  if (input.json || !process.stdin.isTTY) {
    return {
      app: null,
      error: `Multiple apps found for stack '${input.stack}'. Use --server to disambiguate or run ramp link interactively.`,
    };
  }

  const selected = await promptForAppSelection(lookup.apps);

  if (selected === null) {
    return {
      app: null,
      error: 'No app selected.',
    };
  }

  if (input.persistOnDisambiguation && input.configPath) {
    const projectRoot = path.dirname(input.configPath);
    const linkData: LinkedProject = {
      app_id: selected.id,
      server_id: selected.server?.id ?? null,
      stack: selected.stack,
      linked_at: new Date().toISOString(),
    };

    await writeProjectLink(projectRoot, linkData);
  }

  return { app: selected, error: null };
}

export async function promptForAppSelection(apps: AppMatch[]): Promise<AppMatch | null> {
  return selectWithArrows(
    'Select app',
    apps.map((app) => {
      const serverName = app.server?.name ?? 'unknown-server';

      return {
        label: `${app.stack}  on ${serverName}  [${app.status}]`,
        value: app,
      };
    }),
  );
}

export async function readStackFromConfigFile(configFilePath: string): Promise<string | null> {
  const yaml = await readFile(configFilePath, 'utf8');
  const document = parseDocument(yaml);

  if (document.errors.length > 0) {
    return null;
  }

  const parsed = document.toJSON() as { stack?: unknown } | null;

  if (parsed === null || typeof parsed.stack !== 'string' || parsed.stack.trim() === '') {
    return null;
  }

  return parsed.stack;
}

export async function lookupAppsByStack(input: {
  apiUrl: string;
  credentials: StoredCredentials;
  stack: string;
  server?: string;
}): Promise<{ apps: AppMatch[]; error: string | null }> {
  return lookupApps({
    apiUrl: input.apiUrl,
    credentials: input.credentials,
    stack: input.stack,
    server: input.server,
  });
}

export async function lookupApps(input: {
  apiUrl: string;
  credentials: StoredCredentials;
  stack?: string;
  server?: string;
}): Promise<{ apps: AppMatch[]; error: string | null }> {
  try {
    const endpoint = new URL(buildApiV1Endpoint(input.apiUrl, '/apps'));

    if (typeof input.stack === 'string' && input.stack.trim() !== '') {
      endpoint.searchParams.set('stack', input.stack);
    }

    if (typeof input.server === 'string' && input.server.trim() !== '') {
      endpoint.searchParams.set('server', input.server.trim());
    }

    const response = await fetch(endpoint, {
      headers: buildApiHeaders({
        token: input.credentials.token,
        selectedWorkspaceId: input.credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      return {
        apps: [],
        error: await describeApiError(response, 'Failed to lookup apps'),
      };
    }

    const payload = (await response.json()) as AppsResponse;

    return {
      apps: Array.isArray(payload.data) ? payload.data : [],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      apps: [],
      error: `Failed to lookup apps: ${message}`,
    };
  }
}

async function getAppById(input: {
  apiUrl: string;
  credentials: StoredCredentials;
  appId: string;
}): Promise<{ app: AppMatch | null; error: string | null }> {
  try {
    const endpoint = new URL(buildApiV1Endpoint(input.apiUrl, `/apps/${input.appId}`));
    const response = await fetch(endpoint, {
      headers: buildApiHeaders({
        token: input.credentials.token,
        selectedWorkspaceId: input.credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { app: null, error: null };
      }

      return {
        app: null,
        error: await describeApiError(response, 'Failed to resolve linked app'),
      };
    }

    const payload = (await response.json()) as AppShowResponse;

    return {
      app: payload.data ?? null,
      error: null,
    };
  } catch {
    return { app: null, error: null };
  }
}

function linkedAppWorkspaceMismatchError(
  credentials: StoredCredentials,
  app: AppMatch,
): string | null {
  if (!credentials.selectedWorkspaceId || app.workspace_id === credentials.selectedWorkspaceId) {
    return null;
  }

  return 'This linked project belongs to a different CLI workspace. Run `ramp workspace` to switch or `ramp link` to relink this directory.';
}
