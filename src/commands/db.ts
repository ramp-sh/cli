import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

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
  status?: string;
};

type BackupListResponse = {
  data?: BackupItem[];
};

type BackupActionResponse = {
  ok?: boolean;
  backup?: { id?: string };
  errors?: string[];
};

type SqlResource = {
  name: string;
  type: 'postgres' | 'mysql' | 'mariadb';
};

type AppDetailsResponse = {
  data?: {
    id?: string;
    stack?: string;
    sql_resources?: SqlResource[];
  };
};

type DatabaseImportResponse = {
  ok?: boolean;
  import?: {
    id?: string;
    status?: string;
    resource?: string;
    restore_format?: string;
  };
  errors?: string[];
};

type ImportFormat = 'dump' | 'sql' | 'sql.gz';

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

    const payload = (await listResponse.json()) as BackupListResponse;

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    for (const row of payload.data ?? []) {
      process.stdout.write(`${row.id} ${row.status ?? 'unknown'} ${row.created_at}\n`);
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
    process.stderr.write(`${await describeApiError(response, 'Failed to create backup')}\n`);
    return 1;
  }

  const payload = (await response.json()) as BackupActionResponse;

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

    const payload = (await listResponse.json()) as BackupListResponse;

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
    process.stderr.write(`${await describeApiError(response, 'Failed to restore backup')}\n`);
    return 1;
  }

  const payload = (await response.json()) as BackupActionResponse;

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

export async function runDbImportCommand(
  options: BaseOptions & { file?: string; resource?: string },
): Promise<number> {
  if (!options.file || options.file.trim() === '') {
    process.stderr.write(`${statusLine('error', 'Provide a dump file with --file.')}\n`);
    return 1;
  }

  const filePath = path.resolve(options.file.trim());
  const localFormat = detectImportFormat(filePath);

  if (localFormat === null) {
    process.stderr.write(
      `${statusLine('error', 'Unsupported dump file. Use .dump, .sql, or .sql.gz.')}\n`,
    );
    return 1;
  }

  let fileSize = 0;

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      process.stderr.write(`${statusLine('error', 'The import path must point to a file.')}\n`);
      return 1;
    }

    fileSize = fileStat.size;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`${statusLine('error', `Cannot read import file: ${message}`)}\n`);
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

  const detailsResponse = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}`),
    {
      method: 'GET',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
    },
  );

  if (!detailsResponse.ok) {
    process.stderr.write(`${await describeApiError(detailsResponse, 'Failed to load app details')}\n`);
    return 1;
  }

  const details = (await detailsResponse.json()) as AppDetailsResponse;
  const sqlResources = details.data?.sql_resources ?? [];

  if (sqlResources.length === 0) {
    process.stderr.write(`${statusLine('error', 'No SQL resource found for this app.')}\n`);
    return 1;
  }

  const selectedResource = selectSqlResource(sqlResources, options.resource);

  if (selectedResource.error !== null) {
    process.stderr.write(`${statusLine('error', selectedResource.error)}\n`);
    return 1;
  }

  const resource = selectedResource.resource as SqlResource;

  if (!isFormatAllowed(resource.type, localFormat)) {
    process.stderr.write(
      `${statusLine(
        'error',
        `${resource.type} imports do not support ${describeFormat(localFormat)} files.`,
      )}\n`,
    );
    return 1;
  }

  if (!options.json && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
      process.stdout.write(
        `${box([
          statusLine(
            'warning',
            `Import ${paint(path.basename(filePath), 'bold')} into ${paint(
              resolved.context.app.stack,
              'bold',
            )}.`,
          ),
          keyHint(`Resource: ${resource.name} (${resource.type})`),
          keyHint(`Format: ${describeFormat(localFormat)}`),
          keyHint('Ramp will create a fresh safety backup before applying this dump.'),
        ])}\n`,
      );

      const answer = (await rl.question('Continue with database import? [y/N]: '))
        .trim()
        .toLowerCase();

      if (answer !== 'y' && answer !== 'yes') {
        process.stderr.write('Import cancelled.\n');
        return 130;
      }
    } finally {
      rl.close();
    }
  }

  const fileBuffer = await readFile(filePath);
  const dumpBlob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('dump', dumpBlob, path.basename(filePath));
  formData.append('resource', resource.name);

  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/db/imports`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
      body: formData,
    },
  );

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to queue database import')}\n`);
    return 1;
  }

  const payload = (await response.json()) as DatabaseImportResponse;

  if (payload.ok !== true) {
    process.stderr.write(`${payload.errors?.[0] ?? 'Failed to queue database import.'}\n`);
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    process.stdout.write(
      `${box([
        statusLine('success', `Database import queued for ${paint(resolved.context.app.stack, 'bold')}`),
        keyHint(`Import ID: ${payload.import?.id ?? 'unknown'}`),
        keyHint(`Resource: ${payload.import?.resource ?? resource.name}`),
        keyHint(`Format: ${describeFormat(payload.import?.restore_format as ImportFormat | undefined ?? localFormat)}`),
        keyHint(`Upload size: ${formatBytes(fileSize)}`),
      ])}\n`,
    );
  }

  return 0;
}

function detectImportFormat(filePath: string): ImportFormat | null {
  const normalized = filePath.trim().toLowerCase();

  if (normalized.endsWith('.sql.gz')) {
    return 'sql.gz';
  }

  if (normalized.endsWith('.dump')) {
    return 'dump';
  }

  if (normalized.endsWith('.sql')) {
    return 'sql';
  }

  return null;
}

function selectSqlResource(
  resources: SqlResource[],
  resourceName?: string,
): { resource: SqlResource | null; error: string | null } {
  if (resourceName && resourceName.trim() !== '') {
    const resource = resources.find((candidate) => candidate.name === resourceName.trim()) ?? null;

    if (resource !== null) {
      return { resource, error: null };
    }

    return {
      resource: null,
      error: `Unknown SQL resource. Available resources: ${resources.map((item) => item.name).join(', ')}`,
    };
  }

  if (resources.length === 1) {
    return { resource: resources[0] ?? null, error: null };
  }

  return {
    resource: null,
    error: `Provide --resource. Available SQL resources: ${resources.map((item) => item.name).join(', ')}`,
  };
}

function isFormatAllowed(resourceType: SqlResource['type'], format: ImportFormat): boolean {
  if (resourceType === 'postgres') {
    return format === 'dump' || format === 'sql';
  }

  return format === 'sql' || format === 'sql.gz';
}

function describeFormat(format: ImportFormat | undefined): string {
  return format === 'dump'
    ? 'PostgreSQL custom dump (.dump)'
    : format === 'sql.gz'
      ? 'Compressed SQL dump (.sql.gz)'
      : 'Plain SQL dump (.sql)';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
