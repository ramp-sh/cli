import sodium from 'libsodium-wrappers-sumo';

export type EnvRecipient = {
  available: boolean;
  server_agent_id?: string | null;
  key_id?: string | null;
  algorithm?: string | null;
  public_key?: string | null;
  fingerprint?: string | null;
  trust_state?: string | null;
};

export type EnvEntryPayload = {
  key: string;
  value?: string;
  sealed?: {
    ciphertext: string;
    key_id: string;
    algorithm: string;
  };
};

const referencePattern = /\$\{[^}]+\}/;

export function parseDotEnvContent(content: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [rawKey, ...rest] = line.split('=');
    const key = rawKey.trim();
    const value = rest
      .join('=')
      .trim()
      .replace(/^['"]|['"]$/g, '');

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      continue;
    }

    entries.push({ key, value });
  }

  return entries;
}

export async function buildEnvEntryPayload(
  key: string,
  value: string,
  recipient: EnvRecipient | null | undefined,
): Promise<EnvEntryPayload> {
  if (referencePattern.test(value)) {
    return { key, value };
  }

  if (!recipient?.available || !recipient.public_key || !recipient.key_id || !recipient.algorithm) {
    throw new Error(missingRecipientMessage(recipient));
  }

  await sodium.ready;

  const publicKey = sodium.from_base64(recipient.public_key, sodium.base64_variants.ORIGINAL);
  const ciphertext = sodium.crypto_box_seal(sodium.from_string(value), publicKey);

  return {
    key,
    sealed: {
      ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      key_id: recipient.key_id,
      algorithm: recipient.algorithm,
    },
  };
}

function missingRecipientMessage(recipient: EnvRecipient | null | undefined): string {
  if (recipient?.trust_state === 'mismatch') {
    return 'The server sealing key changed unexpectedly. Re-establish trust and re-enter the secret.';
  }

  if (recipient?.trust_state === 'pending') {
    return 'Waiting for the Ramp agent sealing key before saving literal secrets.';
  }

  return 'Literal secrets must be sealed before submission.';
}
