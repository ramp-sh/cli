import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type ExecOptions = {
  app?: string;
  server?: string;
  command: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

export async function runExecCommand(options: ExecOptions): Promise<number> {
  if (!options.command.trim()) {
    process.stderr.write('Command is required.\n');
    return 1;
  }

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

  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/commands/exec`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
        contentType: 'application/json',
      }),
      body: JSON.stringify({ command: options.command }),
    },
  );

  const payload = (await response.json()) as {
    output?: string;
    exit_code?: number;
  };

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to run command')}\n`);
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
