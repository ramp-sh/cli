import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { requireAuth } from '../lib/require-auth.js';
import {
  appHeader,
  badge,
  box,
  isInteractiveUi,
  paint,
  statusLine,
  toneForStatus,
} from '../lib/ui.js';

type AppsCommandOptions = {
  stack?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

export async function runAppsCommand(options: AppsCommandOptions): Promise<number> {
  const auth = await requireAuth(options.apiUrl);

  if (auth.error || !auth.context) {
    process.stderr.write(`${statusLine('error', auth.error ?? 'Not logged in.')}\n`);
    return 1;
  }

  const endpoint = new URL(buildApiV1Endpoint(auth.context.apiUrl, '/apps'));

  if (options.stack) {
    endpoint.searchParams.set('stack', options.stack);
  }

  const response = await fetch(endpoint, {
    headers: buildApiHeaders({
      token: auth.context.credentials.token,
      selectedWorkspaceId: auth.context.credentials.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    process.stderr.write(
      `${statusLine('error', await describeApiError(response, 'Failed to list apps'))}\n`,
    );
    return 1;
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      stack: string;
      status: string;
      server?: { name?: string };
    }>;
  };
  const apps = Array.isArray(payload.data) ? payload.data : [];

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data: apps }, null, 2)}\n`);
    return 0;
  }

  if (options.quiet) {
    return 0;
  }

  if (apps.length === 0) {
    process.stdout.write(`${statusLine('info', 'No apps found.')}\n`);
    return 0;
  }

  if (isInteractiveUi()) {
    process.stdout.write(
      `${appHeader(
        'Ramp',
        'Apps',
        options.stack
          ? `Filtered to stack ${paint(options.stack, 'bold')}.`
          : 'Apps available in your current account context.',
      )}\n\n`,
    );
  }

  const lines = apps.map((app) => {
    const server = app.server?.name ?? 'unknown-server';

    return `${paint(app.stack, 'bold')}  ${badge(
      app.status,
      toneForStatus(app.status),
    )}  ${paint(server, 'gray')}`;
  });

  process.stdout.write(`${box(lines)}\n`);

  return 0;
}
