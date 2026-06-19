import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { parseDotEnvContent } from '../lib/dotenv.js';
import { ensureEnvFingerprintSecret } from '../lib/env-fingerprint.js';
import { buildEnvEntryPayload, type EnvRecipient } from '../lib/env-sealing.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { paint } from '../lib/ui.js';

type BaseEnvOptions = {
  app?: string;
  server?: string;
  service?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type EnvReadableDiff = {
  key: string;
  before?: string | null;
  after?: string | null;
};

export async function runEnvList(options: BaseEnvOptions): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  const endpoint = new URL(buildApiV1Endpoint(context.apiUrl, `/apps/${context.appId}/env`));

  if (options.service) {
    endpoint.searchParams.set('service', options.service);
  }

  const response = await fetch(endpoint, {
    headers: buildApiHeaders({
      token: context.token,
      selectedWorkspaceId: context.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to list env vars')}\n`);
    return 1;
  }

  const payload = (await response.json()) as {
    data?: Array<{
      key: string;
      value: string | null;
      source: string;
      storage_mode: 'sealed' | 'readable';
      readable_reason?: string | null;
    }>;
  };
  const vars = Array.isArray(payload.data) ? payload.data : [];

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data: vars }, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    for (const env of vars) {
      const renderedValue = env.storage_mode === 'sealed' ? '<sealed>' : (env.value ?? '');
      const reason = env.readable_reason ? `, ${env.readable_reason}` : '';
      process.stdout.write(
        `${env.key}=${renderedValue} (${env.source}, ${env.storage_mode}${reason})\n`,
      );
    }
  }

  return 0;
}

export async function runEnvSet(
  options: BaseEnvOptions & { key: string; value: string },
): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  let payload;

  try {
    const fingerprintSecret = await ensureEnvFingerprintSecret();
    payload = await buildEnvEntryPayload(
      options.key,
      options.value,
      await fetchEnvRecipient(context, options.service),
      {
        secret: fingerprintSecret,
        appId: context.appId,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare env var.';
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const response = await fetch(
    buildApiV1Endpoint(context.apiUrl, `/apps/${context.appId}/env/set`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: context.token,
        selectedWorkspaceId: context.selectedWorkspaceId,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        service: options.service,
        ...payload,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to set env var')}\n`);
    return 1;
  }

  if (!options.quiet) {
    process.stdout.write(`Set ${options.key}.\n`);
  }

  return 0;
}

export async function runEnvDelete(options: BaseEnvOptions & { key: string }): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  const endpoint = new URL(
    buildApiV1Endpoint(
      context.apiUrl,
      `/apps/${context.appId}/env/${encodeURIComponent(options.key)}`,
    ),
  );

  if (options.service) {
    endpoint.searchParams.set('service', options.service);
  }

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: buildApiHeaders({
      token: context.token,
      selectedWorkspaceId: context.selectedWorkspaceId,
    }),
  });

  if (response.status !== 204) {
    process.stderr.write(`${await describeApiError(response, 'Failed to delete env var')}\n`);
    return 1;
  }

  if (!options.quiet) {
    process.stdout.write(`Deleted ${options.key}.\n`);
  }

  return 0;
}

export async function runEnvPull(options: BaseEnvOptions & { output: string }): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  const endpoint = new URL(buildApiV1Endpoint(context.apiUrl, `/apps/${context.appId}/env/export`));

  if (options.service) {
    endpoint.searchParams.set('service', options.service);
  }

  const response = await fetch(endpoint, {
    headers: buildApiHeaders({
      token: context.token,
      selectedWorkspaceId: context.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to pull env vars')}\n`);
    return 1;
  }

  const payload = (await response.json()) as {
    content?: string;
    omitted_sealed_keys?: string[];
  };
  await writeFile(options.output, `${payload.content ?? ''}\n`, { encoding: 'utf8', mode: 0o600 });

  if (!options.quiet) {
    process.stdout.write(`Wrote env vars to ${options.output}.\n`);
    if ((payload.omitted_sealed_keys ?? []).length > 0) {
      process.stdout.write(
        `Omitted sealed vars: ${(payload.omitted_sealed_keys ?? []).join(', ')}.\n`,
      );
    }
  }

  return 0;
}

export async function runEnvPush(
  options: BaseEnvOptions & { file: string; action?: 'push' | 'sync' | 'upload' },
): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  let content: string;

  try {
    content = await readFile(options.file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      process.stderr.write(`Env file not found: ${options.file}\n`);
      return 1;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`Failed to read env file ${options.file}: ${message}\n`);
    return 1;
  }

  const parsedEntries = parseDotEnvContent(content);

  if (parsedEntries.length === 0) {
    process.stderr.write(`No env vars found in ${options.file}.\n`);
    return 1;
  }

  const recipient = await fetchEnvRecipient(context, options.service);
  const fingerprintSecret = await ensureEnvFingerprintSecret();
  let entries;

  try {
    entries = await Promise.all(
      parsedEntries.map((entry) =>
        buildEnvEntryPayload(entry.key, entry.value, recipient, {
          secret: fingerprintSecret,
          appId: context.appId,
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare env vars.';
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const response = await fetch(
    buildApiV1Endpoint(context.apiUrl, `/apps/${context.appId}/env/import`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: context.token,
        selectedWorkspaceId: context.selectedWorkspaceId,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        service: options.service,
        entries,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to push env vars')}\n`);
    return 1;
  }

  const payload = (await response.json()) as {
    imported?: number;
    created?: number;
    updated?: number;
    changed?: number;
    unchanged?: number;
    refreshed?: number;
    sealed_written?: number;
    created_keys?: string[];
    updated_keys?: string[];
    changed_keys?: string[];
    unchanged_keys?: string[];
    refreshed_keys?: string[];
    sealed_written_keys?: string[];
    readable_diffs?: EnvReadableDiff[];
    error?: string;
    message?: string;
    omitted_reference_keys?: string[];
  };

  const imported = payload.imported ?? 0;
  const created = typeof payload.created === 'number' ? payload.created : null;
  const updated = typeof payload.updated === 'number' ? payload.updated : null;
  const changed = typeof payload.changed === 'number' ? payload.changed : null;
  const unchanged = typeof payload.unchanged === 'number' ? payload.unchanged : null;
  const refreshed = typeof payload.refreshed === 'number' ? payload.refreshed : null;
  const sealedWritten =
    typeof payload.sealed_written === 'number' ? payload.sealed_written : refreshed;
  const sealedWrittenKeys = payload.sealed_written_keys ?? payload.refreshed_keys ?? [];
  const readableDiffs = payload.readable_diffs ?? [];

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: options.action ?? 'push',
          file: options.file,
          service: options.service ?? null,
          imported,
          created,
          updated,
          changed,
          unchanged,
          refreshed,
          sealed_written: sealedWritten,
          created_keys: payload.created_keys ?? [],
          updated_keys: payload.updated_keys ?? [],
          changed_keys: payload.changed_keys ?? [],
          unchanged_keys: payload.unchanged_keys ?? [],
          refreshed_keys: payload.refreshed_keys ?? [],
          sealed_written_keys: sealedWrittenKeys,
          readable_diffs: readableDiffs,
          omitted_reference_keys: payload.omitted_reference_keys ?? [],
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (!options.quiet) {
    const verb = envActionVerb(options.action ?? 'push');
    process.stdout.write(
      formatEnvSyncSummary(
        verb,
        imported,
        created,
        updated,
        changed,
        unchanged,
        sealedWritten,
        options.file,
      ),
    );
    process.stdout.write(formatReadableDiffs(readableDiffs));

    if ((payload.omitted_reference_keys ?? []).length > 0) {
      process.stdout.write(
        `Skipped reference-backed keys: ${(payload.omitted_reference_keys ?? []).join(', ')}.\n`,
      );
    }
  }

  return 0;
}

function formatEnvSyncSummary(
  verb: string,
  imported: number,
  created: number | null,
  updated: number | null,
  changed: number | null,
  unchanged: number | null,
  sealedWritten: number | null,
  file: string,
): string {
  if (created === null || updated === null) {
    return `${verb} ${formatEnvVarCount(imported)} from ${file}.\n`;
  }

  if (changed === null || unchanged === null || sealedWritten === null) {
    const details = `${created} created, ${updated} updated`;
    const noNewNote =
      created === 0 && updated > 0
        ? '\nNo new env vars were created; existing writable keys were updated.'
        : '';

    return `${verb} ${formatEnvVarCount(imported)} from ${file} (${details}).${noNewNote}\n`;
  }

  const details = [
    formatSummaryBucket(created, 'created', 'green'),
    formatSummaryBucket(changed, 'readable changed', 'yellow'),
    formatSummaryBucket(sealedWritten, 'sealed written', 'cyan'),
    formatSummaryBucket(unchanged, 'unchanged', 'gray'),
  ].join(', ');
  const notes: string[] = [];

  if (created === 0 && changed === 0 && sealedWritten === 0 && unchanged > 0) {
    notes.push('No env var values changed.');
  } else if (created === 0 && changed === 0 && sealedWritten > 0) {
    notes.push('No new env vars or readable value changes were detected.');
  }

  if (sealedWritten > 0) {
    notes.push(
      'Sealed written means no matching local fingerprint was found, so Ramp stored new sealed ciphertext.',
    );
  }

  const noteText = notes.length > 0 ? `\n${notes.join('\n')}` : '';

  return `${verb} ${formatEnvVarCount(imported)} from ${file} (${details}).${noteText}\n`;
}

function formatEnvVarCount(count: number): string {
  return `${count} env ${count === 1 ? 'var' : 'vars'}`;
}

function formatSummaryBucket(
  count: number,
  label: string,
  tone: 'green' | 'yellow' | 'cyan' | 'gray',
): string {
  const colors = count > 0 ? tone : 'gray';

  return paint(`${count} ${label}`, colors);
}

function formatReadableDiffs(diffs: EnvReadableDiff[]): string {
  if (diffs.length === 0) {
    return '';
  }

  const lines = [paint('Readable changes:', 'bold')];

  for (const diff of diffs) {
    lines.push(paint(diff.key, 'bold'));
    lines.push(`  ${paint('-', 'red')} ${formatDiffValue(diff.before)}`);
    lines.push(`  ${paint('+', 'green')} ${formatDiffValue(diff.after)}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatDiffValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '<hidden>';
  }

  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function envActionVerb(action: 'push' | 'sync' | 'upload'): string {
  if (action === 'sync') {
    return 'Synced';
  }

  if (action === 'upload') {
    return 'Uploaded';
  }

  return 'Imported';
}

async function resolve(options: BaseEnvOptions): Promise<{
  token: string;
  apiUrl: string;
  selectedWorkspaceId?: string;
  appId: string;
} | null> {
  const resolved = await resolveProjectContext({
    app: options.app,
    server: options.server,
    apiUrl: options.apiUrl,
    json: options.json,
  });

  if (resolved.error || !resolved.context) {
    process.stderr.write(`${resolved.error ?? 'Unable to resolve project context.'}\n`);
    return null;
  }

  return {
    token: resolved.context.token,
    apiUrl: resolved.context.apiUrl,
    selectedWorkspaceId: resolved.context.selectedWorkspaceId,
    appId: resolved.context.app.id,
  };
}

async function fetchEnvRecipient(
  context: {
    token: string;
    apiUrl: string;
    selectedWorkspaceId?: string;
    appId: string;
  },
  service?: string,
): Promise<EnvRecipient | null> {
  const endpoint = new URL(buildApiV1Endpoint(context.apiUrl, `/apps/${context.appId}/env`));

  if (service) {
    endpoint.searchParams.set('service', service);
  }

  const response = await fetch(endpoint, {
    headers: buildApiHeaders({
      token: context.token,
      selectedWorkspaceId: context.selectedWorkspaceId,
    }),
  });

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to fetch env recipient')}\n`);
    return null;
  }

  const payload = (await response.json()) as { recipient?: EnvRecipient };
  return payload.recipient ?? null;
}
