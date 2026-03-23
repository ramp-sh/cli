import process from 'node:process';
import { buildEndpoint, buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { ensureSelectedWorkspaceId, readCredentials } from '../lib/auth-store.js';
import { tryOpenBrowser } from '../lib/browser.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { keyHint, paint, statusLine } from '../lib/ui.js';

type BrowserCommandOptions = {
  app?: string;
  server?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type AppLinksResponse = {
  data?: {
    id: string;
    stack: string;
    browser_url?: string | null;
    dashboard_url?: string | null;
  };
};

type MeResponse = {
  dashboard_url?: string | null;
};

type OpenMode = 'app' | 'dashboard';

type Target = {
  url: string;
  source: 'app' | 'dashboard' | 'dashboard_fallback';
  app?: {
    id: string;
    stack: string;
  };
};

export async function runOpenCommand(options: BrowserCommandOptions): Promise<number> {
  return runBrowserCommand(options, 'app');
}

export async function runDashboardCommand(options: BrowserCommandOptions): Promise<number> {
  return runBrowserCommand(options, 'dashboard');
}

async function runBrowserCommand(options: BrowserCommandOptions, mode: OpenMode): Promise<number> {
  const target = await resolveBrowserTarget(options, mode);

  if (target.error !== null || target.target === null) {
    process.stderr.write(
      `${statusLine('error', target.error ?? 'Unable to determine a URL to open.')}\n`,
    );
    return 1;
  }

  const opened = tryOpenBrowser(target.target.url);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          data: {
            url: target.target.url,
            source: target.target.source,
            opened,
            app: target.target.app ?? null,
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(
      `${statusLine(
        opened ? 'success' : 'info',
        opened
          ? `Opened ${paint(target.target.url, 'bold')} in your browser.`
          : 'Could not open a browser automatically.',
      )}\n`,
    );
    process.stdout.write(`${keyHint(`URL: ${target.target.url}`)}\n`);
  }

  return 0;
}

async function resolveBrowserTarget(
  options: BrowserCommandOptions,
  mode: OpenMode,
): Promise<{ target: Target | null; error: string | null }> {
  const resolved = await resolveProjectContext({
    app: options.app,
    server: options.server,
    apiUrl: options.apiUrl,
    json: options.json,
  });

  if (resolved.context !== null) {
    return fetchAppTarget(resolved.context, mode);
  }

  if (resolved.error !== null && shouldFallbackToDashboard(options, resolved.error)) {
    return fetchDashboardTarget(options);
  }

  return {
    target: null,
    error: resolved.error ?? 'Unable to resolve project context.',
  };
}

async function fetchAppTarget(
  context: NonNullable<Awaited<ReturnType<typeof resolveProjectContext>>['context']>,
  mode: OpenMode,
): Promise<{ target: Target | null; error: string | null }> {
  const response = await fetch(buildApiV1Endpoint(context.apiUrl, `/apps/${context.app.id}`), {
    headers: buildApiHeaders({
      token: context.token,
      selectedWorkspaceId: context.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    return {
      target: null,
      error: await describeApiError(response, 'Failed to fetch app details'),
    };
  }

  const payload = (await response.json()) as AppLinksResponse;
  const app = payload.data;
  const browserUrl = app?.browser_url?.trim() || null;
  const dashboardUrl = app?.dashboard_url?.trim() || null;

  if (!app) {
    return {
      target: null,
      error: 'Invalid app response from API.',
    };
  }

  if (mode === 'dashboard') {
    if (!dashboardUrl) {
      return {
        target: null,
        error: 'No dashboard URL is available for this app.',
      };
    }

    return {
      target: {
        url: dashboardUrl,
        source: 'dashboard',
        app: { id: app.id, stack: app.stack },
      },
      error: null,
    };
  }

  if (browserUrl) {
    return {
      target: {
        url: browserUrl,
        source: 'app',
        app: { id: app.id, stack: app.stack },
      },
      error: null,
    };
  }

  if (dashboardUrl) {
    return {
      target: {
        url: dashboardUrl,
        source: 'dashboard_fallback',
        app: { id: app.id, stack: app.stack },
      },
      error: null,
    };
  }

  return {
    target: null,
    error: 'No browser URL is available for this app yet.',
  };
}

async function fetchDashboardTarget(
  options: BrowserCommandOptions,
): Promise<{ target: Target | null; error: string | null }> {
  const credentials = await readCredentials();

  if (credentials === null) {
    return {
      target: null,
      error: 'Not logged in. Run `ramp login` first.',
    };
  }

  const resolvedCredentials = await ensureSelectedWorkspaceId({
    ...credentials,
    apiUrl: options.apiUrl ?? credentials.apiUrl,
  });
  const apiUrl = resolvedCredentials.apiUrl;

  const response = await fetch(buildEndpoint(apiUrl, '/api/v1/auth/me'), {
    headers: buildApiHeaders({
      token: resolvedCredentials.token,
      selectedWorkspaceId: resolvedCredentials.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    return {
      target: null,
      error: await describeApiError(response, 'Failed to fetch dashboard URL'),
    };
  }

  const payload = (await response.json()) as MeResponse;
  const dashboardUrl = payload.dashboard_url?.trim() || null;

  if (!dashboardUrl) {
    return {
      target: null,
      error: 'No dashboard URL is available for this account.',
    };
  }

  return {
    target: {
      url: dashboardUrl,
      source: 'dashboard',
    },
    error: null,
  };
}

function shouldFallbackToDashboard(
  options: Pick<BrowserCommandOptions, 'app' | 'server'>,
  error: string,
): boolean {
  if (options.app || options.server) {
    return false;
  }

  return (
    error.includes('No ramp.yaml found in current directory or parent directories.') ||
    error.includes('Unable to determine `stack` from ramp.yaml.')
  );
}
