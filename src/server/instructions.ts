/**
 * Server instructions, read from the environment.
 *
 * MCP clients receive these in the `initialize` result and typically add them
 * to the model's context, so they are the one place to tell every client
 * (Claude Code, Claude Desktop, Codex, Cursor, ...) what this vault is and when
 * to use it. Unset = no instructions, as before.
 */

import { readFileSync } from 'node:fs';

export function readInstructions(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env.MCP_INSTRUCTIONS_FILE;
  // A configured file that cannot be read is a deployment mistake: fail at
  // startup rather than serve silently without the instructions.
  const text = file ? readFileSync(file, 'utf8') : env.MCP_INSTRUCTIONS;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}
