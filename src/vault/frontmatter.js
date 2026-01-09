/**
 * Frontmatter parsing and serialization utilities
 */

/**
 * Parse YAML frontmatter from markdown content
 * @param {string} content - Full markdown content
 * @returns {{ frontmatter: object|null, body: string, raw: string|null }}
 */
export function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: null, body: content, raw: null };
  }

  const raw = match[1];
  const frontmatter = {};

  // Simple YAML parser for common frontmatter patterns
  const lines = raw.split('\n');
  let currentKey = null;
  let currentValue = [];
  let inArray = false;

  for (const line of lines) {
    // Check for array item
    if (inArray && line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      currentValue.push(value.replace(/^["']|["']$/g, ''));
      continue;
    }

    // If we were building an array, save it
    if (inArray && currentKey) {
      frontmatter[currentKey] = currentValue;
      currentKey = null;
      currentValue = [];
      inArray = false;
    }

    // Check for key: value pair
    const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyValueMatch) {
      const [, key, value] = keyValueMatch;

      if (value === '' || value === '[]') {
        // Start of array or empty value
        currentKey = key;
        currentValue = [];
        inArray = true;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array like [tag1, tag2]
        const arrayContent = value.slice(1, -1);
        frontmatter[key] = arrayContent
          .split(',')
          .map(v => v.trim().replace(/^["']|["']$/g, ''))
          .filter(v => v);
      } else {
        // Simple value
        frontmatter[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  // Handle final array if file ends while in array
  if (inArray && currentKey) {
    frontmatter[currentKey] = currentValue;
  }

  const body = content.slice(match[0].length).replace(/^\r?\n/, '');

  return { frontmatter, body, raw };
}

/**
 * Serialize frontmatter object back to YAML string
 * @param {object} frontmatter - Frontmatter object to serialize
 * @returns {string} YAML string
 */
export function serializeFrontmatter(frontmatter) {
  const lines = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      }
    } else if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else {
      // Quote strings that contain special characters
      const strValue = String(value);
      if (strValue.includes(':') || strValue.includes('#') || strValue.includes("'") || strValue.includes('"')) {
        lines.push(`${key}: "${strValue.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }

  return lines.join('\n');
}
