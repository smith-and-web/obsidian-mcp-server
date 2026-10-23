import fs from 'fs';
import { BUILTIN_PATTERNS } from './redact.js';

export interface LearnConfig {
  enabled: boolean;
  patterns: RegExp[];
  retentionDays: number;
  error: string | null;
}

export function readLearnConfig(env: NodeJS.ProcessEnv): LearnConfig {
  let retentionDays = 30;
  const disabled = (error: string | null): LearnConfig => ({
    enabled: false,
    patterns: [],
    retentionDays,
    error,
  });
  try {
    const retention = env.LEARN_RETENTION_DAYS || '30';
    const days = Number(retention);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return disabled(
        `Invalid LEARN_RETENTION_DAYS=${retention}: expected an integer from 1 to 3650`
      );
    }
    retentionDays = days;
    const enabled = env.LEARN_LOG || 'false';
    if (enabled !== 'true' && enabled !== 'false') {
      return disabled(`Invalid LEARN_LOG=${enabled}: expected true or false`);
    }
    if (enabled === 'false') return disabled(null);
    const file = env.LEARN_REDACT_PATTERNS_FILE;
    if (!file) return disabled('LEARN_REDACT_PATTERNS_FILE is required when LEARN_LOG=true');
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return disabled(`Cannot read LEARN_REDACT_PATTERNS_FILE ${file}: ${(err as Error).message}`);
    }
    const patterns = [...BUILTIN_PATTERNS];
    for (const [i, raw] of content.split('\n').entries()) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      try {
        patterns.push(new RegExp(line, 'i'));
      } catch (err) {
        return disabled(`Invalid pattern on line ${i + 1} of ${file}: ${(err as Error).message}`);
      }
    }
    return { enabled: true, patterns, retentionDays, error: null };
  } catch (err) {
    return disabled((err as Error).message);
  }
}
