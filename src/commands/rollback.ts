import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type RollbackCommandOptions = {
  app?: string;
  server?: string;
  deployId?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

export async function runRollbackCommand(options: RollbackCommandOptions): Promise<number> {
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
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/rollback`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        deploy_id: options.deployId,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(
      `Failed to rollback: ${await describeApiError(response, 'Failed to rollback app')}\n`,
    );
    return 1;
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
    rolled_back_to?: { id?: string; commit_sha?: string };
  };

  if (payload.ok !== true) {
    process.stderr.write(`${payload.errors?.[0] ?? 'Failed to rollback app.'}\n`);
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(`Rollback queued for ${resolved.context.app.stack}.\n`);

    if (payload.rolled_back_to?.id) {
      process.stdout.write(`Target deploy: ${payload.rolled_back_to.id}\n`);
    }
  }

  return 0;
}
