export interface Heat {
  score: number;
  bucket: number;
}
export interface RelatedItem {
  path: string;
  title: string;
  linked: boolean;
}
export interface TrailItem extends RelatedItem {
  weight: number;
  events: number;
  lastAt: string;
}
export interface SimilarItem extends RelatedItem {
  score: number;
}
export interface RelatedResponse {
  path: string;
  title: string;
  heat: Heat | null;
  trails: TrailItem[];
  similar: SimilarItem[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function notePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.endsWith('.md') &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part => !!part && part !== '.' && part !== '..' && !part.startsWith('.'))
  );
}
function item(value: unknown): value is Record<string, unknown> {
  return (
    object(value) &&
    notePath(value.path) &&
    typeof value.title === 'string' &&
    typeof value.linked === 'boolean'
  );
}

/** Reject malformed responses without including their content in the error. */
export function parseRelated(value: unknown): RelatedResponse {
  if (
    !object(value) ||
    !notePath(value.path) ||
    typeof value.title !== 'string' ||
    !(
      value.heat === null ||
      (object(value.heat) &&
        finite(value.heat.score) &&
        Number.isInteger(value.heat.bucket) &&
        Number(value.heat.bucket) >= 0 &&
        Number(value.heat.bucket) <= 5)
    ) ||
    !Array.isArray(value.trails) ||
    !value.trails.every(
      t =>
        item(t) &&
        finite(t.weight) &&
        Number.isInteger(t.events) &&
        Number(t.events) >= 0 &&
        typeof t.lastAt === 'string' &&
        Number.isFinite(Date.parse(t.lastAt))
    ) ||
    !Array.isArray(value.similar) ||
    !value.similar.every(s => item(s) && finite(s.score))
  ) {
    throw new Error('Invalid related notes response');
  }
  return value as unknown as RelatedResponse;
}
