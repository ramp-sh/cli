import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { buildEnvEntryPayload, parseDotEnvContent, type EnvRecipient } from '../lib/env-sealing.js';
import { resolveProjectContext } from '../lib/project-resolver.js';

type BaseEnvOptions = {
  app?: string;
  server?: string;
  service?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
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
    payload = await buildEnvEntryPayload(
      options.key,
      options.value,
      await fetchEnvRecipient(context, options.service),
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

export async function runEnvPush(options: BaseEnvOptions & { file: string }): Promise<number> {
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

  const recipient = await fetchEnvRecipient(context, options.service);
  let entries;

  try {
    entries = await Promise.all(
      parseDotEnvContent(content).map((entry) =>
        buildEnvEntryPayload(entry.key, entry.value, recipient),
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
    error?: string;
    message?: string;
  };

  if (!options.quiet) {
    process.stdout.write(`Imported ${payload.imported ?? 0} env vars from ${options.file}.\n`);
  }

  return 0;
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
