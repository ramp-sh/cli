import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const ENV_FINGERPRINT_ALGORITHM = 'hmac-sha256-local-v1';

const keyFileName = 'env-fingerprint-key';

export async function ensureEnvFingerprintSecret(): Promise<string | null> {
  const explicit = process.env.RAMP_ENV_FINGERPRINT_KEY?.trim();

  if (explicit) {
    return explicit;
  }

  const filePath = path.join(os.homedir(), '.config', 'ramp', keyFileName);

  try {
    const existing = (await readFile(filePath, 'utf8')).trim();

    if (existing !== '') {
      return existing;
    }
  } catch {
    // Generate a key below when the file is missing or unreadable.
  }

  const secret = randomBytes(32).toString('base64url');

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(filePath, 0o600);

    return secret;
  } catch {
    return null;
  }
}

export function fingerprintSealedEnvValue(input: {
  secret: string;
  appId: string;
  key: string;
  value: string;
}): string {
  const context = ['ramp-env-v1', input.appId, input.key, input.value].join('\0');

  return createHmac('sha256', input.secret).update(context).digest('hex');
}
