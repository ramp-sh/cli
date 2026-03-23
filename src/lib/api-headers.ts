export function buildApiHeaders(input: {
  token: string;
  selectedWorkspaceId?: string | null;
  accept?: string;
  contentType?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: input.accept ?? 'application/json',
    Authorization: `Bearer ${input.token}`,
  };

  if (input.contentType) {
    headers['Content-Type'] = input.contentType;
  }

  if (typeof input.selectedWorkspaceId === 'string' && input.selectedWorkspaceId !== '') {
    headers['X-Ramp-Workspace'] = input.selectedWorkspaceId;
  }

  return headers;
}
