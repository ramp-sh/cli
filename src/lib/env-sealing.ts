import sodium from 'libsodium-wrappers-sumo';
import { ENV_FINGERPRINT_ALGORITHM, fingerprintSealedEnvValue } from './env-fingerprint.js';

export { parseDotEnvContent } from './dotenv.js';

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
    fingerprint?: string;
    fingerprint_algorithm?: string;
  };
};

export type EnvFingerprintContext = {
  secret: string | null;
  appId: string;
};

const referencePattern = /\$\{[^}]+\}/;

export async function buildEnvEntryPayload(
  key: string,
  value: string,
  recipient: EnvRecipient | null | undefined,
  fingerprintContext?: EnvFingerprintContext | null,
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

  const fingerprint =
    fingerprintContext?.secret && fingerprintContext.appId
      ? fingerprintSealedEnvValue({
          secret: fingerprintContext.secret,
          appId: fingerprintContext.appId,
          key,
          value,
        })
      : null;

  return {
    key,
    sealed: {
      ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      key_id: recipient.key_id,
      algorithm: recipient.algorithm,
      ...(fingerprint
        ? {
            fingerprint,
            fingerprint_algorithm: ENV_FINGERPRINT_ALGORITHM,
          }
        : {}),
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
