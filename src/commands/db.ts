import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type BaseOptions = {
  app?: string;
  server?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type BackupItem = {
  id: string;
  created_at: string;
};

export async function runDbBackupCommand(
  options: BaseOptions & { list?: boolean },
): Promise<number> {
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
    const listResponse = await fetch(
      buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/db/backups`),
      {
        method: 'GET',
        headers: buildApiHeaders({
          token: resolved.context.token,
          selectedWorkspaceId: resolved.context.selectedWorkspaceId,
        }),
      },
    );

    if (!listResponse.ok) {
      process.stderr.write(`${await describeApiError(listResponse, 'Failed to list backups')}\n`);
      return 1;
    }

    const payload = await listResponse.json();

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    for (const row of payload.data ?? []) {
      process.stdout.write(`${row.id} ${row.status} ${row.created_at}\n`);
    }

    return 0;
  }

  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/db/backups`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(
      `Failed to create backup: ${await describeApiError(response, 'Failed to create backup')}\n`,
    );
    return 1;
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    backup?: { id?: string };
    errors?: string[];
  };

  if (payload.ok !== true) {
    process.stderr.write(`${payload.errors?.[0] ?? 'Failed to create backup.'}\n`);
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(`Backup queued for ${resolved.context.app.stack}.\n`);
    process.stdout.write(`Backup ID: ${payload.backup?.id}\n`);
  }

  return 0;
}

export async function runDbRestoreCommand(
  options: BaseOptions & { backupId?: string; latest?: boolean },
): Promise<number> {
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

  let backupId = options.backupId;

  if (options.latest || !backupId) {
    const listResponse = await fetch(
      buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/db/backups`),
      {
        method: 'GET',
        headers: buildApiHeaders({
          token: resolved.context.token,
          selectedWorkspaceId: resolved.context.selectedWorkspaceId,
        }),
      },
    );

    if (!listResponse.ok) {
      process.stderr.write(`${await describeApiError(listResponse, 'Failed to list backups')}\n`);
      return 1;
    }

    const payload = await listResponse.json();

    const latest = (payload.data ?? [])[0] as BackupItem | undefined;

    if (!latest) {
      process.stderr.write('No backups available to restore.\n');
      return 1;
    }

    backupId = latest.id;
  }

  if (!backupId) {
    process.stderr.write('Provide a backup id or use --latest.\n');
    return 1;
  }

  if (!options.json && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
      const answer = (await rl.question(`Restore backup ${backupId}? [y/N]: `))
        .trim()
        .toLowerCase();

      if (answer !== 'y' && answer !== 'yes') {
        process.stderr.write('Restore cancelled.\n');
        return 130;
      }
    } finally {
      rl.close();
    }
  }

  const response = await fetch(
    buildApiV1Endpoint(
      resolved.context.apiUrl,
      `/apps/${resolved.context.app.id}/db/backups/${backupId}/restore`,
    ),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(
      `Failed to restore backup: ${await describeApiError(response, 'Failed to restore backup')}\n`,
    );
    return 1;
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
  };

  if (payload.ok !== true) {
    process.stderr.write(`${payload.errors?.[0] ?? 'Failed to restore backup.'}\n`);
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(`Restore queued for ${resolved.context.app.stack}.\n`);
    process.stdout.write(`Backup ID: ${backupId}\n`);
  }

  return 0;
}
