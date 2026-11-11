/**
 * Sanitizes an arbitrary identifier for safe use as a single path segment.
 * Shared by every filesystem-backed store so the rule exists in one place.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}
