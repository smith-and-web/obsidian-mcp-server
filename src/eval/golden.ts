import fs from 'fs';

export const CATEGORIES = [
  'exact-id',
  'paraphrase',
  'decision-why',
  'multi-hop',
  'recent',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface GoldenQuery {
  id: string;
  category: Category;
  query: string;
  expected: string[];
}

export interface Golden {
  version: 1;
  created: string;
  notes: string;
  queries: GoldenQuery[];
}

export function validateGolden(obj: unknown): string[] {
  const problems: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value: Record<string, unknown>, required: string[], where: string) => {
    for (const key of required) {
      if (!Object.hasOwn(value, key)) problems.push(`${where}: missing key ${key}`);
    }
    for (const key of Object.keys(value)) {
      if (!required.includes(key)) problems.push(`${where}: unknown key ${key}`);
    }
  };
  const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
  if (!object(obj)) return ['golden: expected an object'];
  keys(obj, ['version', 'created', 'notes', 'queries'], 'golden');
  if (obj.version !== 1) problems.push('version: expected 1');
  if (typeof obj.created !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.created)) {
    problems.push('created: expected YYYY-MM-DD');
  }
  if (typeof obj.notes !== 'string') problems.push('notes: expected a string');
  if (!Array.isArray(obj.queries) || !obj.queries.length) {
    problems.push('queries: expected a non-empty array');
    return problems;
  }
  const ids = new Set<string>();
  obj.queries.forEach((query, index) => {
    const where = `queries[${index}]`;
    if (!object(query)) {
      problems.push(`${where}: expected an object`);
      return;
    }
    keys(query, ['id', 'category', 'query', 'expected'], where);
    if (!nonempty(query.id)) problems.push(`${where}.id: expected a non-empty string`);
    else {
      if (ids.has(query.id)) problems.push(`${where}.id: duplicate id ${query.id}`);
      ids.add(query.id);
    }
    if (!CATEGORIES.includes(query.category as Category))
      problems.push(`${where}.category: unknown category`);
    if (!nonempty(query.query)) problems.push(`${where}.query: expected a non-empty string`);
    if (!Array.isArray(query.expected) || !query.expected.length) {
      problems.push(`${where}.expected: expected a non-empty array`);
    } else {
      const paths = new Set<string>();
      query.expected.forEach((value, i) => {
        if (!nonempty(value) || !value.endsWith('.md')) {
          problems.push(`${where}.expected[${i}]: expected a non-empty path ending in .md`);
        }
        if (typeof value === 'string') {
          if (paths.has(value))
            problems.push(`${where}.expected[${i}]: duplicate expected path ${value}`);
          paths.add(value);
        }
      });
    }
  });
  return problems;
}

export function loadGolden(file: string): Golden {
  const obj: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateGolden(obj);
  if (problems.length) throw new Error(problems.join('\n'));
  return obj as Golden;
}
