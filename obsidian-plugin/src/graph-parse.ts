export interface GraphNode {
  path: string;
  title: string;
  type: string;
  up: string[];
  heat: number;
  score: number;
}
export interface GraphResponse {
  nodes: GraphNode[];
  links: [number, number][];
  trails: [number, number, number][];
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
/** Reject malformed graph data without exposing response content. */
export function parseGraph(value: unknown): GraphResponse {
  const invalid = () => {
    throw new Error('Invalid graph response');
  };
  if (
    !object(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.links) ||
    !Array.isArray(value.trails)
  )
    return invalid();
  if (
    !value.nodes.every(
      n =>
        object(n) &&
        notePath(n.path) &&
        typeof n.title === 'string' &&
        typeof n.type === 'string' &&
        Array.isArray(n.up) &&
        n.up.every(u => typeof u === 'string') &&
        Number.isInteger(n.heat) &&
        Number(n.heat) >= 0 &&
        Number(n.heat) <= 5 &&
        finite(n.score)
    )
  )
    return invalid();
  const count = value.nodes.length;
  const index = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < count;
  if (
    !value.links.every(e => Array.isArray(e) && e.length === 2 && index(e[0]) && index(e[1])) ||
    !value.trails.every(
      e => Array.isArray(e) && e.length === 3 && index(e[0]) && index(e[1]) && finite(e[2])
    )
  )
    return invalid();
  return value as unknown as GraphResponse;
}
