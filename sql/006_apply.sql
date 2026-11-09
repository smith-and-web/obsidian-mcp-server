-- Auto-apply (server >= 1.17.0): a finding can be applied, by Josh's acceptance or by a graduated class.
-- Idempotent: constraints are dropped and re-added with the wider value sets.
ALTER TABLE maintenance_findings DROP CONSTRAINT IF EXISTS maintenance_findings_status_check;
ALTER TABLE maintenance_findings ADD CONSTRAINT maintenance_findings_status_check
  CHECK (status IN ('open', 'accepted', 'rejected', 'resolved', 'applied'));
ALTER TABLE maintenance_findings DROP CONSTRAINT IF EXISTS maintenance_findings_decided_via_check;
ALTER TABLE maintenance_findings ADD CONSTRAINT maintenance_findings_decided_via_check
  CHECK (decided_via IN ('checkbox', 'tool', 'auto'));
ALTER TABLE change_classes ADD COLUMN IF NOT EXISTS demoted_at timestamptz;
CREATE INDEX IF NOT EXISTS brain_changes_collection_at ON brain_changes (collection, at);
CREATE INDEX IF NOT EXISTS brain_changes_finding ON brain_changes (finding_id);
