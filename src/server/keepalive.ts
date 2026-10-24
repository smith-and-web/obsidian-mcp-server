/**
 * SSE keepalive configuration. Some MCP clients drop a legacy SSE stream that
 * has carried no bytes for a few minutes, then reconnect without sending
 * `initialize` again, which loses the session. A periodic SSE comment keeps
 * the stream from looking idle; every SSE parser ignores comment lines.
 */

export const DEFAULT_KEEPALIVE_SECONDS = 30;

export interface KeepaliveConfig {
  seconds: number;
  error: string | null;
}

/**
 * Read `SSE_KEEPALIVE_SECONDS`: an integer from 0 to 3600, where 0 disables
 * the ping. An invalid value keeps the default and reports why.
 */
export function readKeepaliveConfig(env: NodeJS.ProcessEnv = process.env): KeepaliveConfig {
  const raw = env.SSE_KEEPALIVE_SECONDS;
  if (raw === undefined || raw === '') return { seconds: DEFAULT_KEEPALIVE_SECONDS, error: null };
  const seconds = Number(raw);
  if (!/^\d+$/.test(raw) || seconds > 3600) {
    return {
      seconds: DEFAULT_KEEPALIVE_SECONDS,
      error: `Invalid SSE_KEEPALIVE_SECONDS=${raw}: expected an integer from 0 to 3600`,
    };
  }
  return { seconds, error: null };
}
