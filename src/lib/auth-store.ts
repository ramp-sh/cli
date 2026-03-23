import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { buildEndpoint } from './api-url.js';

export type StoredCredentials = {
  token: string;
  apiUrl: string;
  email?: string;
  selectedWorkspaceId?: string;
  updatedAt: string;
};

function credentialsPath(): string {
  return path.join(os.homedir(), '.config', 'ramp', 'credentials.json');
}

export async function readCredentials(): Promise<StoredCredentials | null> {
  const envToken = process.env.RAMP_TOKEN?.trim();

  if (typeof envToken === 'string' && envToken !== '') {
    return {
      token: envToken,
      apiUrl: process.env.RAMP_API_URL?.trim() || 'https://api.ramp.sh',
      email: process.env.RAMP_EMAIL,
      selectedWorkspaceId: process.env.RAMP_WORKSPACE_ID?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const raw = await readFile(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;

    if (typeof parsed.token !== 'string' || parsed.token === '') {
      return null;
    }

    if (typeof parsed.apiUrl !== 'string' || parsed.apiUrl === '') {
      return null;
    }

    return {
      token: parsed.token,
      apiUrl: parsed.apiUrl,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      selectedWorkspaceId:
        typeof parsed.selectedWorkspaceId === 'string' && parsed.selectedWorkspaceId !== ''
          ? parsed.selectedWorkspaceId
          : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  const filePath = credentialsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

export async function clearCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true });
}

type MeResponse = {
  current_workspace_id?: string | null;
};

export async function ensureSelectedWorkspaceId(
  credentials: StoredCredentials,
): Promise<StoredCredentials> {
  if (
    typeof credentials.selectedWorkspaceId === 'string' &&
    credentials.selectedWorkspaceId !== ''
  ) {
    return credentials;
  }

  try {
    const response = await fetch(buildEndpoint(credentials.apiUrl, '/api/v1/auth/me'), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) {
      return credentials;
    }

    const payload = (await response.json()) as MeResponse;
    const workspaceId = payload.current_workspace_id?.trim();

    if (!workspaceId) {
      return credentials;
    }

    const updated = {
      ...credentials,
      selectedWorkspaceId: workspaceId,
      updatedAt: new Date().toISOString(),
    };

    if (!process.env.RAMP_TOKEN?.trim()) {
      await saveCredentials(updated);
    }

    return updated;
  } catch {
    return credentials;
  }
}
