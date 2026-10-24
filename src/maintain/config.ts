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
    return {
      config: {
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
        maxPerClass: numeric('MAINTAIN_MAX_PER_CLASS', 10, 100),
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
