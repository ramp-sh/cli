type ApiErrorPayload = {
  error?: string;
  message?: string;
  errors?: string[] | Record<string, string[] | string>;
};

export async function describeApiError(response: Response, fallback: string): Promise<string> {
  const payload = await readApiErrorPayload(response);

  if (response.status === 401) {
    return 'Authentication failed. Run `ramp login` again.';
  }

  if (response.status === 402 || payload.error === 'subscription_required') {
    const message =
      typeof payload.message === 'string' && payload.message.trim() !== ''
        ? payload.message.trim()
        : 'An active subscription is required for this command.';

    return `${trimTrailingPeriod(message)}. Use \`ramp workspace\` to switch workspaces or visit your dashboard to subscribe.`;
  }

  const extractedError = extractPayloadError(payload);

  if (extractedError !== null) {
    return extractedError;
  }

  return `${fallback} (HTTP ${response.status}).`;
}

async function readApiErrorPayload(response: Response): Promise<ApiErrorPayload> {
  try {
    return (await response.clone().json()) as ApiErrorPayload;
  } catch {
    return {};
  }
}

function extractPayloadError(payload: ApiErrorPayload): string | null {
  const errors = payload.errors;

  if (Array.isArray(errors) && typeof errors[0] === 'string') {
    return errors[0];
  }

  if (errors && typeof errors === 'object') {
    for (const value of Object.values(errors)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
      }

      if (typeof value === 'string' && value.trim() !== '') {
        return value;
      }
    }
  }

  if (typeof payload.message === 'string' && payload.message.trim() !== '') {
    return payload.message.trim();
  }

  if (
    typeof payload.error === 'string' &&
    payload.error.trim() !== '' &&
    payload.error !== 'Unauthorized'
  ) {
    return payload.error.trim();
  }

  return null;
}

function trimTrailingPeriod(message: string): string {
  return message.replace(/\.+$/, '');
}
