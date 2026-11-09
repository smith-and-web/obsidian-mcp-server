import pg from 'pg';

/** Graduation and demotion thresholds (proposal #20). */
export const GRADUATE_DECISIONS = 20;
export const GRADUATE_RATE = 0.9;
export const DEMOTE_REVERT_RATE = 0.1;

export interface DocInfo {
  path: string;
  title: string;
  type: string;
  tags: string[];
  sha: string;
  frontmatterError: boolean;
}
export interface ApplyFinding {
  id: number;
  class: string;
  key: string;
  paths: string[];
  detail: Record<string, unknown>;
  status: string;
  decidedVia: string | null;
}
export interface ChangeRow {
  id: number;
  at: Date;
  class: string;
  path: string;
  findingId: number | null;
  beforeSha: string;
  afterSha: string;
  beforeText: string;
  revertedAt: Date | null;
}
export interface ClassState {
  class: string;
  graduable: boolean;
  mode: string;
  decided: number;
  accepted: number;
  applied: number;
  reverted: number;
  autoApplied: number;
  autoReverted: number;
  demotedAt: Date | null;
  decidedSinceDemotion: number;
  acceptedSinceDemotion: number;
}

/** Auto-apply's own queries. A separate pool keeps the search store untouched. */
export class ApplyStore {
  private pool: pg.Pool;
  constructor(
    connectionString: string,
    readonly collection: string
  ) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }
  async close() {
    await this.pool.end();
  }

  async docs(paths: string[]): Promise<Map<string, DocInfo>> {
    const r = await this.pool.query(
      `SELECT path,title,coalesce(frontmatter->>'type','') AS type,tags,content_sha256 AS sha,
        frontmatter_error IS NOT NULL AS "frontmatterError"
      FROM documents WHERE collection=$1 AND path=ANY($2::text[])`,
      [this.collection, paths]
    );
    return new Map(r.rows.map(row => [row.path, row as DocInfo]));
  }

  /** The link text Obsidian resolves to `path`: its basename when unique, else the path without .md. */
  async linkText(path: string): Promise<string> {
    const base = path.split('/').pop()!.replace(/\.md$/i, '');
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM documents WHERE collection=$1
      AND (path=$2 OR right(path,length($2)+1)='/'||$2)`,
      [this.collection, `${base}.md`]
    );
    return r.rows[0].n > 1 ? path.replace(/\.md$/i, '') : base;
  }

  async findings(where: string, params: unknown[]): Promise<ApplyFinding[]> {
    const r = await this.pool.query(
      `SELECT id,class,finding_key AS key,paths,detail,status,decided_via AS "decidedVia"
      FROM maintenance_findings WHERE collection=$1 AND ${where} ORDER BY id`,
      [this.collection, ...params]
    );
    return r.rows.map(row => ({ ...row, id: Number(row.id) }));
  }

  async changesSince(at: Date): Promise<number> {
    const r = await this.pool.query(
      'SELECT count(*)::int AS n FROM brain_changes WHERE collection=$1 AND at>$2',
      [this.collection, at]
    );
    return r.rows[0].n;
  }

  /** Journal the changes and mark the finding applied, in one transaction. */
  async recordApplied(
    finding: ApplyFinding,
    changes: { path: string; beforeText: string; beforeSha: string; afterSha: string }[],
    auto: boolean
  ): Promise<number[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ids: number[] = [];
      for (const c of changes) {
        const r = await client.query(
          `INSERT INTO brain_changes(collection,class,path,finding_id,before_sha,after_sha,before_text)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            this.collection,
            finding.class,
            c.path,
            finding.id,
            c.beforeSha,
            c.afterSha,
            c.beforeText,
          ]
        );
        ids.push(Number(r.rows[0].id));
      }
      await client.query(
        auto
          ? `UPDATE maintenance_findings SET status='applied',decided_via='auto',decided_at=now()
            WHERE id=$1 AND collection=$2`
          : `UPDATE maintenance_findings SET status='applied' WHERE id=$1 AND collection=$2`,
        [finding.id, this.collection]
      );
      await client.query('COMMIT');
      return ids;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async change(id: number): Promise<ChangeRow | null> {
    const r = await this.pool.query(
      `SELECT id,at,class,path,finding_id AS "findingId",before_sha AS "beforeSha",after_sha AS "afterSha",
        before_text AS "beforeText",reverted_at AS "revertedAt"
      FROM brain_changes WHERE collection=$1 AND id=$2`,
      [this.collection, id]
    );
    return r.rows[0] ? this.changeRow(r.rows[0]) : null;
  }
  private changeRow(row: ChangeRow): ChangeRow {
    return {
      ...row,
      id: Number(row.id),
      findingId: row.findingId === null ? null : Number(row.findingId),
    };
  }

  async findingChanges(findingId: number): Promise<ChangeRow[]> {
    const r = await this.pool.query(
      `SELECT id,at,class,path,finding_id AS "findingId",before_sha AS "beforeSha",after_sha AS "afterSha",
        before_text AS "beforeText",reverted_at AS "revertedAt"
      FROM brain_changes WHERE collection=$1 AND finding_id=$2 ORDER BY id`,
      [this.collection, findingId]
    );
    return r.rows.map(row => this.changeRow(row));
  }

  async changesBetween(from: Date, to: Date): Promise<ChangeRow[]> {
    const r = await this.pool.query(
      `SELECT id,at,class,path,finding_id AS "findingId",before_sha AS "beforeSha",after_sha AS "afterSha",
        '' AS "beforeText",reverted_at AS "revertedAt"
      FROM brain_changes WHERE collection=$1 AND at>$2 AND at<=$3 ORDER BY id`,
      [this.collection, from, to]
    );
    return r.rows.map(row => this.changeRow(row));
  }

  /** Mark changes reverted; the finding becomes a rejection, so it is not proposed again. */
  async recordReverted(ids: number[], findingId: number | null, undoId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE brain_changes SET reverted_at=now() WHERE collection=$1 AND id=ANY($2::bigint[])',
        [this.collection, ids]
      );
      if (findingId !== null)
        await client.query(
          `UPDATE maintenance_findings SET status='rejected',decided_at=now(),
          decided_via=coalesce(decided_via,'tool'),decision_note=$3 WHERE id=$1 AND collection=$2`,
          [findingId, this.collection, `reverted by brain-undo ${undoId}`]
        );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async classStates(): Promise<ClassState[]> {
    const r = await this.pool.query(
      `SELECT c.class,c.graduable,c.mode,c.decided,c.accepted,c.demoted_at AS "demotedAt",
        (SELECT count(*)::int FROM brain_changes b WHERE b.collection=c.collection AND b.class=c.class) AS applied,
        (SELECT count(*)::int FROM brain_changes b WHERE b.collection=c.collection AND b.class=c.class
          AND b.reverted_at IS NOT NULL) AS reverted,
        (SELECT count(*)::int FROM brain_changes b JOIN maintenance_findings f ON f.id=b.finding_id
          WHERE b.collection=c.collection AND b.class=c.class AND f.decided_via='auto') AS "autoApplied",
        (SELECT count(*)::int FROM brain_changes b JOIN maintenance_findings f ON f.id=b.finding_id
          WHERE b.collection=c.collection AND b.class=c.class AND f.decided_via='auto'
          AND b.reverted_at IS NOT NULL) AS "autoReverted",
        (SELECT count(*)::int FROM maintenance_findings f WHERE f.collection=c.collection AND f.class=c.class
          AND f.decided_via IN ('checkbox','tool') AND f.status IN ('accepted','rejected','applied')
          AND f.decided_at > c.demoted_at) AS "decidedSinceDemotion",
        (SELECT count(*)::int FROM maintenance_findings f WHERE f.collection=c.collection AND f.class=c.class
          AND f.decided_via IN ('checkbox','tool') AND f.status IN ('accepted','applied')
          AND f.decided_at > c.demoted_at) AS "acceptedSinceDemotion"
      FROM change_classes c WHERE c.collection=$1 ORDER BY c.class`,
      [this.collection]
    );
    return r.rows;
  }

  async setMode(cls: string, mode: 'report' | 'apply', demote: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE change_classes SET mode=$3,updated_at=now()${demote ? ',demoted_at=now()' : ''}
      WHERE collection=$1 AND class=$2`,
      [this.collection, cls, mode]
    );
  }
}
