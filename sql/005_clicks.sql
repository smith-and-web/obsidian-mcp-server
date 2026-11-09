-- Query-click rerank (server >= 1.17.0): the alternate order is logged here when SEARCH_CLICKS=shadow.
-- Same shape as `shadow`: { ranker, results: [{ path, ord, rank }] }.
ALTER TABLE search_log ADD COLUMN IF NOT EXISTS shadow_clicks jsonb;
