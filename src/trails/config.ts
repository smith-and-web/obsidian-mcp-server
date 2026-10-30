export interface TrailsConfig {
  databaseUrl: string;
  collection: string;
  vaultPath: string;
  tz: string;
  windowDays: number;
  halfLifeDays: number;
  thresholds: number[];
  heatTypes: string[];
  writeHeat: boolean;
  heatMinAgeMinutes: number;
  heatMaxWrites: number;
  notePath: string;
  notePerNote: number;
  noteMaxSources: number;
  noteMinWeight: number;
}
export function readTrailsConfig(
  env: NodeJS.ProcessEnv
): { config: TrailsConfig } | { error: string } {
  try {
    for (const name of ['DATABASE_URL', 'VAULT_PATH'])
      if (!env[name]) return { error: `${name} is required` };
    const tz = env.TRAILS_TZ || 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      return { error: `Invalid TRAILS_TZ=${tz}: expected an IANA time zone` };
    }
    const number = (name: string, fallback: number, min: number, max: number, integer = true) => {
      const raw = env[name] ?? String(fallback),
        value = Number(raw);
      if (
        !raw.trim() ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isInteger(value))
      )
        throw new Error(
          `Invalid ${name}=${raw}: expected ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`
        );
      return value;
    };
    const raw = env.TRAILS_HEAT_THRESHOLDS ?? '1,3,6,12,24';
    const thresholds = raw.split(',').map(Number);
    if (
      thresholds.length !== 5 ||
      thresholds.some((v, i) => !Number.isFinite(v) || v <= 0 || (i > 0 && v <= thresholds[i - 1]))
    )
      return {
        error: `Invalid TRAILS_HEAT_THRESHOLDS=${raw}: expected five strictly ascending positive numbers`,
      };
    const write = env.TRAILS_WRITE_HEAT ?? 'false';
    if (!['true', 'false'].includes(write))
      return { error: `Invalid TRAILS_WRITE_HEAT=${write}: expected true or false` };
    const notePath = env.TRAILS_NOTE_PATH ?? '';
    if (
      notePath &&
      (notePath.startsWith('/') ||
        notePath.includes('..') ||
        notePath.includes('\\') ||
        !notePath.endsWith('.md'))
    )
      return {
        error: `Invalid TRAILS_NOTE_PATH=${notePath}: expected a vault-relative .md path without ..`,
      };
    return {
      config: {
        databaseUrl: env.DATABASE_URL!,
        collection: env.INDEX_COLLECTION || 'default',
        vaultPath: env.VAULT_PATH!,
        tz,
        windowDays: number('TRAILS_WINDOW_DAYS', 180, 7, 3650),
        halfLifeDays: number('TRAILS_HALF_LIFE_DAYS', 30, 1, 365),
        thresholds,
        heatTypes: (env.TRAILS_HEAT_TYPES ?? '')
          .split(',')
          .map(v => v.trim())
          .filter(Boolean),
        writeHeat: write === 'true',
        heatMinAgeMinutes: number('TRAILS_HEAT_MIN_AGE_MINUTES', 30, 0, 1440),
        heatMaxWrites: number('TRAILS_HEAT_MAX_WRITES', 400, 1, 5000),
        notePath,
        notePerNote: number('TRAILS_NOTE_PER_NOTE', 5, 1, 20),
        noteMaxSources: number('TRAILS_NOTE_MAX_SOURCES', 60, 1, 500),
        noteMinWeight: number('TRAILS_NOTE_MIN_WEIGHT', 1, 0, 1000, false),
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
