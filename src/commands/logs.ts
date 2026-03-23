import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type LogsOptions = {
  app?: string;
  server?: string;
  type: 'laravel' | 'php' | 'caddy' | 'systemd';
  service?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

export async function runLogsCommand(options: LogsOptions): Promise<number> {
  const resolved = await resolveProjectContext({
    app: options.app,
    server: options.server,
    apiUrl: options.apiUrl,
    json: options.json,
  });

  if (resolved.error || !resolved.context) {
    process.stderr.write(`${resolved.error ?? 'Unable to resolve project context.'}\n`);
    return 1;
  }

  const endpoint = new URL(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/logs`),
  );
  endpoint.searchParams.set('type', options.type);

  if (options.service) {
    endpoint.searchParams.set('service', options.service);
  }

  const response = await fetch(endpoint, {
    headers: buildApiHeaders({
      token: resolved.context.token,
      selectedWorkspaceId: resolved.context.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to fetch logs')}\n`);
    return 1;
  }

  const payload = (await response.json()) as {
    output?: string;
    type?: string;
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(`${payload.output ?? ''}\n`);
  }

  return 0;
}
