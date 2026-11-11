/**
 * Runtime limits and timeouts, grouped by the subsystem that owns them.
 *
 * These are intentionally code-level constraints (not user preferences or
 * environment configuration): changing them balances responsiveness against
 * resource use and should be reviewed together with the subsystem.
 */
export const HTTP_TIMEOUTS = {
  /** OpenAI-compatible endpoint capability probe (`/v1/models`). */
  endpointProbeMs: 5_000,
  /** Connection verification when adding/activating an external API. */
  connectionProbeMs: 15_000,
  /** Health/status sampling of the local Splash engine. */
  engineStatusMs: 2_500,
} as const;

export const SSE = {
  /** Comment frame that keeps idle event streams alive. */
  heartbeatMs: 15_000,
} as const;

export const ENGINE = {
  /** How often a ready engine is health-probed. */
  probeIntervalMs: 2_000,
  /** Consecutive failed probes before an engine is declared dead. */
  probeFailureLimit: 3,
  /** Grace period between SIGINT and SIGKILL for the serve process. */
  stopGraceMs: 10_000,
  /** Timeout for the one-off `device-check` binary. */
  deviceCheckTimeoutMs: 8_000,
  /** How long a device-check result stays valid. */
  deviceCheckCacheMs: 300_000,
  /** Maximum number of stderr lines retained for failure diagnostics. */
  stderrTailLimit: 300,
  /** Delay before forcing process exit after HTTP shutdown. */
  shutdownExitDelayMs: 500,
} as const;

export const DOWNLOAD = {
  /** Speed/ETA sampling interval. */
  etaTickMs: 1_000,
  /** Grace period between SIGINT and SIGKILL for `models.py prepare`. */
  prepareKillGraceMs: 5_000,
} as const;

export const MCP = {
  protocolVersion: '2024-11-05',
  clientName: 'sharti',
  clientVersion: '1.0.0',
  /** Server handshake timeout. */
  initTimeoutMs: 30_000,
  /** Tool discovery and tool call timeout. */
  callTimeoutMs: 120_000,
  /** Poll interval for external mcp.json changes. */
  configPollIntervalMs: 3_000,
  /** Grace period between SIGTERM and SIGKILL for MCP servers. */
  killGraceMs: 2_000,
  /** Maximum number of stderr lines retained per server. */
  stderrTailLimit: 50,
} as const;

export const UPLOADS = {
  /** Maximum size of a single chat file upload. */
  maxBytes: 32 * 1024 * 1024,
} as const;

export const TOOLS = {
  /** Default timeout for a native `run_command` invocation. */
  defaultTimeoutMs: 30_000,
  /** Hard ceiling for a user-supplied command timeout. */
  maxTimeoutMs: 300_000,
  /** Maximum captured stdout/stderr size per stream. */
  maxOutputBytes: 100_000,
  /** Maximum accepted command length. */
  maxCommandLength: 8_000,
  /** Soft cap for `read_file` (~500 KB). */
  readFileMaxBytes: 512_000,
  /** Maximum directory depth for recursive listings. */
  maxListDepth: 10,
} as const;
