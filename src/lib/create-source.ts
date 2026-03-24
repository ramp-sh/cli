export type CreateSourceType = 'repo' | 'upload';

export function resolveInteractiveCreateSourceSelection(
  selected: CreateSourceType | null,
): CreateSourceType | null {
  return selected;
}
