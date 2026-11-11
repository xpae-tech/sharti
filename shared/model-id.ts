/**
 * Extracts the downloadable variant/quant from a model id.
 * Examples:
 *   "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M" -> "UD-Q4_K_M"
 *   "mlx-community/Qwen3.8-27B-4bit"     -> "MLX"
 *   "/models/file.gguf"                  -> "file"
 */
export function modelVariant(id: string): string {
  if (!id) return '';
  if (id.startsWith('/')) return id.split('/').slice(-2, -1)[0] || '';
  const parts = id.split(':');
  if (parts.length > 1) return parts[1];
  return id.toLowerCase().includes('mlx') ? 'MLX' : (id.split('/').pop() ?? '');
}

/**
 * Fallback display name derived from a model id when the catalog has no
 * entry. Shared by the backend status label and the frontend model lists so
 * the same id always renders identically.
 */
export function modelDisplayName(id: string): string {
  if (!id) return '';
  if (id.startsWith('/')) return id.split('/').filter(Boolean).pop()?.replace(/\.gguf$/i, '') ?? '';
  const repo = id.split(':')[0].split('/').pop() || id;
  const lower = repo.toLowerCase();
  if (lower.endsWith('-gguf')) return repo.slice(0, -5);
  if (lower.endsWith('-mlx')) return repo.slice(0, -4);
  return repo;
}
