import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findUpFile } from './find-up-file.js';

export type LinkedProject = {
  app_id: string;
  server_id: string | null;
  stack: string;
  linked_at: string;
  ssh_identity?: string;
};

export async function readProjectLink(
  startDir?: string,
): Promise<{ path: string; value: LinkedProject } | null> {
  const linkPath = await findUpFile(path.join('.ramp', 'config.json'), startDir);

  if (linkPath === null) {
    return null;
  }

  try {
    const raw = await readFile(linkPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LinkedProject>;

    if (typeof parsed.app_id !== 'string' || parsed.app_id === '') {
      return null;
    }

    if (typeof parsed.stack !== 'string' || parsed.stack === '') {
      return null;
    }

    return {
      path: linkPath,
      value: {
        app_id: parsed.app_id,
        server_id: typeof parsed.server_id === 'string' ? parsed.server_id : null,
        stack: parsed.stack,
        linked_at:
          typeof parsed.linked_at === 'string' ? parsed.linked_at : new Date().toISOString(),
        ssh_identity: typeof parsed.ssh_identity === 'string' ? parsed.ssh_identity : undefined,
      },
    };
  } catch {
    return null;
  }
}

export async function writeProjectLink(projectRoot: string, value: LinkedProject): Promise<string> {
  const linkDir = path.join(projectRoot, '.ramp');
  const linkPath = path.join(linkDir, 'config.json');

  await mkdir(linkDir, { recursive: true });
  await writeFile(linkPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

  return linkPath;
}

export async function updateProjectLink(
  linkPath: string,
  updates: Partial<LinkedProject>,
): Promise<void> {
  try {
    const raw = await readFile(linkPath, 'utf8');
    const existing = JSON.parse(raw) as LinkedProject;
    const merged = { ...existing, ...updates };
    await writeFile(linkPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  } catch {
    // Silently ignore if link file doesn't exist or is malformed.
  }
}

export async function removeProjectLink(linkPath: string): Promise<void> {
  await rm(linkPath, { force: true });

  const linkDir = path.dirname(linkPath);

  try {
    await rm(linkDir);
  } catch {
    // Keep directory if not empty.
  }
}
