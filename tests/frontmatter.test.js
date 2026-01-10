import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, reconstructContent } from '../src/vault/frontmatter.js';

describe('parseFrontmatter', () => {
  it('should parse basic frontmatter', () => {
    const content = `---
title: Test Note
tags:
  - test
  - demo
---

# Content here`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({
      title: 'Test Note',
      tags: ['test', 'demo'],
    });
    expect(result.body.trim()).toBe('# Content here');
  });

  it('should return null frontmatter when none exists', () => {
    const content = '# Just a heading\n\nSome content';

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it('should handle inline array syntax', () => {
    const content = `---
tags: [one, two, three]
---

Body`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.tags).toEqual(['one', 'two', 'three']);
  });

  it('should handle dates', () => {
    const content = `---
created: 2025-01-09
---

Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.created).toBeDefined();
  });

  it('should handle empty frontmatter', () => {
    const content = `---
---

Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toBeNull();
  });
});

describe('serializeFrontmatter', () => {
  it('should serialize object to YAML', () => {
    const frontmatter = {
      title: 'Test',
      status: 'active',
    };

    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('title: Test');
    expect(yaml).toContain('status: active');
  });

  it('should serialize arrays', () => {
    const frontmatter = {
      tags: ['one', 'two', 'three'],
    };

    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('tags:');
    expect(yaml).toContain('- one');
    expect(yaml).toContain('- two');
    expect(yaml).toContain('- three');
  });

  it('should handle empty arrays', () => {
    const frontmatter = {
      tags: [],
    };

    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('tags: []');
  });
});

describe('reconstructContent', () => {
  it('should combine frontmatter and body', () => {
    const frontmatter = { title: 'Test' };
    const body = '# Content';

    const result = reconstructContent(frontmatter, body);

    expect(result).toContain('---');
    expect(result).toContain('title: Test');
    expect(result).toContain('# Content');
  });

  it('should return body only when no frontmatter', () => {
    const body = '# Just content';

    const result = reconstructContent(null, body);

    expect(result).toBe(body);
  });

  it('should return body only for empty frontmatter', () => {
    const body = '# Just content';

    const result = reconstructContent({}, body);

    expect(result).toBe(body);
  });
});
