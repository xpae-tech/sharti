// Formatting utilities (mirror of native Format.*)

export function fmtSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null;
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1).replace(/\.0$/, '') : Math.round(gb)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

export function compactNum(v: number | null | undefined): string {
  if (v == null) return '0';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
}

export function fmtDuration(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  const t = Math.round(sec * 10) / 10;
  if (t < 10) return `${t.toFixed(1)}s`;
  const w = Math.round(sec);
  return w < 60 ? `${w}s` : `${Math.floor(w / 60)}m ${(w % 60)}s`;
}

export function contextFigure(tok: number | null | undefined): string | null {
  if (tok == null) return null;
  if (tok >= 1e6) return `${(tok / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (tok >= 1e3) return `${Math.ceil(tok / 1e3)}K`;
  return String(tok);
}

/**
 * Compact context badge label. Values are rounded up to the next thousand
 * (1…1000 → 1k, 1001…2000 → 2k); from one million the unit switches to `m`.
 * Zero/unknown values produce an empty label so the badge can be hidden.
 */
export function formatTokenBadge(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '';
  if (tokens >= 1_000_000) return `${Math.ceil(tokens / 1_000_000)}m`;
  return `${Math.ceil(tokens / 1_000)}k`;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Host + path of a base URL, for compact status labels. */
export function shortUrl(u: string): string {
  if (!u) return '';
  try { const p = new URL(u); return p.host + p.pathname; } catch { return u; }
}

/** Human-readable download progress caption shared by all download cards. */
export function downloadCaption(dl: import('../types').DownloadState): string {
  if (!dl.progress) return 'Preparing download…';
  const amt = `${fmtSize(dl.progress.done)} of ${fmtSize(dl.progress.total)}`;
  const speed = dl.speedBps != null && dl.speedBps > 0 ? fmtSpeed(dl.speedBps) : null;
  let remaining: string | null = null;
  if (dl.remainingSec != null) {
    remaining = dl.remainingSec < 60
      ? 'less than a minute left'
      : `about ${Math.round(dl.remainingSec / 60)} min left`;
  }
  return [amt, speed, remaining].filter(Boolean).join(' · ');
}


/** Network throughput with one decimal for MB/s and GB/s. */
export function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1e9) return `${(bytesPerSec / 1e9).toFixed(1).replace(/\.0$/, '')} GB/s`;
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1).replace(/\.0$/, '')} MB/s`;
  if (bytesPerSec >= 1e3) return `${Math.round(bytesPerSec / 1e3)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}
