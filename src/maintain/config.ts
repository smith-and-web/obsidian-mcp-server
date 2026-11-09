export interface MaintainConfig {
  databaseUrl: string;
  collection: string;
  vaultPath: string;
  reportDir: string;
  reportVaultDir: string;
  timeZone: string;
  linkCosine: number;
  dupCosine: number;
  dupTitleSim: number;
  hubDays: number;
  summaryDrop: number;
  maxPerClass: number;
  coreadMinWeight: number;
  coreadMinEvents: number;
  excludeTags: string[];
  /** Kill switch: false (default) keeps every class report-only. */
  apply: boolean;
  applyWeeklyCap: number;
  applyMinAgeHours: number;
  /** Regex lines (secrets, work infrastructure, private terms); a note matching one is never edited. */
  guardPatternsFile: string;
  /** Frontmatter keys the indexer leaves out of a note's hash (INDEX_VOLATILE_KEYS). */
  volatileKeys: string[];
}

/** Parse worker configuration without throwing; dry runs need no writable report directory. */
export function readMaintainConfig(
  env: NodeJS.ProcessEnv,
  dry = false
): { config: MaintainConfig } | { error: string } {
  try {
    for (const name of ['DATABASE_URL', 'VAULT_PATH', ...(dry ? [] : ['MAINTAIN_REPORT_DIR'])]) {
      if (!env[name]) return { error: `${name} is required` };
    }
    const timeZone = env.MAINTAIN_TZ || 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      return { error: `Invalid MAINTAIN_TZ=${timeZone}: expected an IANA time zone` };
    }
    const numeric = (name: string, fallback: number, max?: number): number => {
      const raw = env[name] || String(fallback);
      const value = Number(raw);
      const valid = max
        ? Number.isInteger(value) && value >= 1 && value <= max
        : Number.isFinite(value) && value > 0 && value < 1;
      if (!valid)
        throw new Error(
          `Invalid ${name}=${raw}: expected ${max ? `an integer from 1 to ${max}` : 'a number between 0 and 1'}`
        );
      return value;
    };
    const coreadMinWeight = Number(env.MAINTAIN_COREAD_MIN_WEIGHT ?? '1.5');
    if (!Number.isFinite(coreadMinWeight) || coreadMinWeight <= 0 || coreadMinWeight > 1000)
      return {
        error: `Invalid MAINTAIN_COREAD_MIN_WEIGHT=${env.MAINTAIN_COREAD_MIN_WEIGHT}: expected a number from 0 to 1000, exclusive of 0`,
      };
    const rawTags = env.MAINTAIN_EXCLUDE_TAGS ?? 'code-graph';
    const excludeTags = rawTags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const badTag = excludeTags.find(t => !/^[a-z0-9][a-z0-9/_-]*$/.test(t));
    if (badTag)
      return {
        error: `Invalid MAINTAIN_EXCLUDE_TAGS tag "${badTag}": expected lowercase letters, digits, -, _ or /`,
      };
    const applyRaw = env.MAINTAIN_APPLY || 'false';
    if (applyRaw !== 'true' && applyRaw !== 'false')
      return { error: `Invalid MAINTAIN_APPLY=${applyRaw}: expected true or false` };
    const volatileKeys = (env.INDEX_VOLATILE_KEYS ?? 'heat')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    return {
      config: {
        excludeTags,
        apply: applyRaw === 'true',
        applyWeeklyCap: numeric('MAINTAIN_APPLY_WEEKLY_CAP', 20, 100),
        applyMinAgeHours: numeric('MAINTAIN_APPLY_MIN_AGE_HOURS', 24, 720),
        guardPatternsFile: env.MAINTAIN_GUARD_PATTERNS_FILE || env.LEARN_REDACT_PATTERNS_FILE || '',
        volatileKeys,
        databaseUrl: env.DATABASE_URL!,
        collection: env.INDEX_COLLECTION || 'default',
        vaultPath: env.VAULT_PATH!,
        reportDir: env.MAINTAIN_REPORT_DIR || '',
        reportVaultDir: env.MAINTAIN_REPORT_VAULT_DIR || '',
        timeZone,
        linkCosine: numeric('MAINTAIN_LINK_COSINE', 0.85),
        dupCosine: numeric('MAINTAIN_DUP_COSINE', 0.92),
        dupTitleSim: numeric('MAINTAIN_DUP_TITLE_SIM', 0.6),
        hubDays: numeric('MAINTAIN_HUB_DAYS', 14, 365),
        summaryDrop: numeric('MAINTAIN_SUMMARY_DROP', 0.05),
        coreadMinWeight,
        coreadMinEvents: numeric('MAINTAIN_COREAD_MIN_EVENTS', 2, 1000),
        maxPerClass: numeric('MAINTAIN_MAX_PER_CLASS', 10, 100),
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
