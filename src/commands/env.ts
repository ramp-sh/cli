import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
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
    data?: Array<{ key: string; value: string; source: string }>;
  };
  const vars = Array.isArray(payload.data) ? payload.data : [];

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data: vars }, null, 2)}\n`);
    return 0;
  }

  if (!options.quiet) {
    for (const env of vars) {
      process.stdout.write(`${env.key}=${env.value} (${env.source})\n`);
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
        key: options.key,
        value: options.value,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(
      `Failed to set env var: ${await describeApiError(response, 'Failed to set env var')}\n`,
    );
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
    process.stderr.write(
      `Failed to delete env var: ${await describeApiError(response, 'Failed to delete env var')}\n`,
    );
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

  const payload = (await response.json()) as { content?: string };
  await writeFile(options.output, `${payload.content ?? ''}\n`, 'utf8');

  if (!options.quiet) {
    process.stdout.write(`Wrote env vars to ${options.output}.\n`);
  }

  return 0;
}

export async function runEnvPush(options: BaseEnvOptions & { file: string }): Promise<number> {
  const context = await resolve(options);

  if (!context) {
    return 1;
  }

  const content = await readFile(options.file, 'utf8');

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
        content,
      }),
    },
  );

  const payload = (await response.json()) as {
    imported?: number;
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    process.stderr.write(
      `Failed to push env vars: ${await describeApiError(response, 'Failed to push env vars')}\n`,
    );
    return 1;
  }

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
