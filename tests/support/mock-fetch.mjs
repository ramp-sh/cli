import { readFileSync, writeFileSync } from 'node:fs';

const fixtures = JSON.parse(process.env.RAMP_FETCH_FIXTURES ?? '[]');
const capturePath = process.env.RAMP_FETCH_CAPTURE;

function normalizeHeaders(headers) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(', ') : String(value),
    ]),
  );
}

function readCapture() {
  if (!capturePath) {
    return [];
  }

  try {
    return JSON.parse(readFileSync(capturePath, 'utf8'));
  } catch {
    return [];
  }
}

function writeCapture(entry) {
  if (!capturePath) {
    return;
  }

  const current = readCapture();
  current.push(entry);
  writeFileSync(capturePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

async function serializeBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  if (body instanceof FormData) {
    const entries = {};

    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') {
        entries[key] = value;
        continue;
      }

      entries[key] = {
        name: value.name,
        type: value.type,
        size: value.size,
      };
    }

    return { __formData: entries };
  }

  return null;
}

globalThis.fetch = async (input, init = {}) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = normalizeHeaders(init.headers);
  const parsedBody = await serializeBody(init.body);

  writeCapture({
    url,
    method,
    headers,
    body: parsedBody,
  });

  const fixture = fixtures.shift();

  if (!fixture) {
    throw new Error(`No fetch fixture configured for ${method} ${url}`);
  }

  if (fixture.url && fixture.url !== url) {
    throw new Error(`Unexpected fetch url. Expected ${fixture.url}, received ${url}`);
  }

  if (fixture.method && fixture.method.toUpperCase() !== method) {
    throw new Error(`Unexpected fetch method. Expected ${fixture.method}, received ${method}`);
  }

  return new Response(JSON.stringify(fixture.body ?? {}), {
    status: fixture.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(fixture.headers ?? {}),
    },
  });
};
