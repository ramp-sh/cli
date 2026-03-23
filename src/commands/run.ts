import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type RunOptions = {
  app?: string;
  server?: string;
  name?: string;
  list: boolean;
  service?: string;
  params: string[];
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

export async function runSavedCommand(options: RunOptions): Promise<number> {
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

  if (options.list) {
    const endpoint = new URL(
      buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/commands`),
    );

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
      process.stderr.write(
        `${await describeApiError(response, 'Failed to list saved commands')}\n`,
      );
      return 1;
    }

    const payload = (await response.json()) as {
      data?: Array<{
        name: string;
        command: string;
        service?: { name?: string };
      }>;
    };
    const commands = Array.isArray(payload.data) ? payload.data : [];

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ data: commands }, null, 2)}\n`);
      return 0;
    }

    if (commands.length === 0) {
      process.stdout.write('No saved commands found.\n');
      return 0;
    }

    for (const command of commands) {
      process.stdout.write(
        `${command.name}  ${command.service?.name ?? 'unknown-service'}  ${command.command}\n`,
      );
    }

    return 0;
  }

  if (!options.name || !options.name.trim()) {
    process.stderr.write('Saved command name is required, or use --list.\n');
    return 1;
  }

  const params = parseParams(options.params);

  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/commands/run`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        name: options.name,
        params,
      }),
    },
  );

  const payload = (await response.json()) as {
    output?: string;
    exit_code?: number;
    error?: string;
  };

  if (!response.ok) {
    process.stderr.write(
      `Run failed: ${await describeApiError(response, 'Failed to run saved command')}\n`,
    );
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload.exit_code ?? 0;
  }

  if (!options.quiet) {
    process.stdout.write(`${payload.output ?? ''}\n`);
  }

  return payload.exit_code ?? 0;
}

function parseParams(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const pair of values) {
    if (!pair.includes('=')) {
      continue;
    }

    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');

    if (key.trim() === '') {
      continue;
    }

    result[key.trim()] = value;
  }

  return result;
}
