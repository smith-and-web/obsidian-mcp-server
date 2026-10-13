# v1.4.1 + v1.5.0 patches — built 2026-10-13 against the v1.4.0 tree

Two commits, one per release, as `git format-patch` output (plus the same two
commits as `obsidian-mcp-server-v1.5.0.bundle` beside this directory).

| Patch | Release | What |
|---|---|---|
| `0001-fix-contain-all-vault-paths-inside-VAULT_PATH.patch` | **1.4.1** | `_resolve()` in VaultManager, all 33 call sites; `tests/pathContainment.test.js` (10 tests); CHANGELOG. Ship and deploy on minipc first (plan phase 1). |
| `0002-feat-optional-pgvector-backed-semantic-search.patch` | **1.5.0** | `src/index/*`, `src/indexer.ts`, `sql/001_schema.sql`, four tools, deps `pg` + `pgvector`, README/CHANGELOG/CLAUDE.md/env.example, Dockerfile copies `sql/`. |

## Apply

```
cd ~/Code/obsidian-mcp-server
git checkout -b fix/path-containment main
git am patches/0001-*.patch
# → PR, merge, tag v1.4.1, deploy

git checkout -b feat/semantic-search main   # after 1.4.1 is merged
git am patches/0002-*.patch
npm ci
```

`0002` was authored on top of `0001`; if `0001` was merged with changes, `git am -3` resolves against the index.

## Verified here before packaging

- `npm test`: 70 passed, 9 skipped (the search suite skips without a database).
- `TEST_DATABASE_URL=postgres://… npm test` against Postgres 16 + pgvector 0.6: 79 passed.
- `npm run lint`, `npm run format:check`, `npx tsc --noEmit`: clean.
- `node dist/indexer.js --once --verbose` over `examples/test-vault` with `EMBED_PROVIDER=fake`: 6 notes, 28 chunks, 0 errors.
- Server with `DATABASE_URL`: `/health` reports `semanticSearch: enabled`, `tools/list` is 35 tools, `semantic-search` ranks `Projects/Project Alpha.md` first for "project alpha milestones", `read-note ../../etc/hostname` returns `Path escapes vault`.
- Server without `DATABASE_URL`: 31 tools, byte-identical behaviour to 1.4.x.

Not verified here: a Docker image build (no daemon in the build sandbox) and Ollama itself (no GPU). The Ollama client targets `POST /api/embed` with `{model, input: [...]}`; the first real call against `nomic-embed-text` is the thing to watch in phase 5.

## CI

`tests/search.test.js` skips unless `TEST_DATABASE_URL` is set. To run it in GitHub Actions add a service to `ci.yml`:

```yaml
    services:
      pgvector:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://test:test@localhost:5432/test
```

`.github/` was not part of what was staged into the build sandbox, so this is described rather than patched.

## Decisions worth a second look

- **Token estimate is chars/4**, no tokenizer dependency. Chunks target 800 tokens with 100 overlap; for `nomic-embed-text` (8k context) there is headroom. If you move to a model with a 512-token window, lower `maxTokens` in `chunkNote`'s options (not yet exposed as env; one line to add).
- **Links resolve by exact path or `path + .md`** in the `links` table. Obsidian's "shortest path" links (`[[note]]` resolving to `Areas/note.md`) only resolve when `newLinkFormat` is `absolute` (plan 3.7a) — which is the recommendation anyway. Unresolved links keep `target_document_id = NULL` and still record `target_path`.
- **`similar-notes` uses a per-document centroid** stored at index time, so it costs one HNSW-free scan over `documents`; fine to a few tens of thousands of notes.
- **`--reindex` drops the collection and, if the dimension changed, drops all tables** (including other collections) because a vector column's dimension is fixed. With one collection that is a non-issue; with two, re-run both indexers.
