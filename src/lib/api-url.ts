export function buildEndpoint(baseUrl: string, routePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${routePath}`;
}

export function normalizeApiV1BaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');

  if (normalized.endsWith('/api/v1')) {
    return normalized;
  }

  if (normalized.endsWith('/api')) {
    return `${normalized}/v1`;
  }

  return `${normalized}/api/v1`;
}

export function buildApiV1Endpoint(baseUrl: string, routePath: string): string {
  return `${normalizeApiV1BaseUrl(baseUrl)}${routePath}`;
}
