import { describe, it, expect } from 'vitest';
import { bodyText, mentions } from '../src/maintain/mentions.js';

describe('mention prose', () => {
  const note = body =>
    `---\ntitle: Sprocket setup\nsummary: "How the sprocket is set up"\n---\n# Sprocket setup\n\n${body}\n`;
  it('drops frontmatter and the first H1 but keeps later headings', () => {
    const text = bodyText(note('Plain text.\n\n# Second sprocket heading'));
    expect(text).not.toContain('Sprocket setup');
    expect(text).not.toContain('How the');
    expect(text).toContain('Second sprocket heading');
  });
  it('drops fenced and inline code, wikilinks, embeds and markdown links', () => {
    const text = bodyText(
      note(
        'Use `sprocket` or ``sprocket --x``.\n\n```sh\nsprocket run\n```\n\n~~~\nsprocket\n~~~\n\n' +
          'See [[Sprocket]], ![[sprocket.png]] and [the sprocket](https://example.com/sprocket).'
      )
    );
    expect(mentions(text, 'sprocket')).toBe(false);
    expect(text).toContain('See');
  });
  it('matches whole words case-insensitively, with hyphens as word characters', () => {
    expect(mentions('Deployed kindling-splash today.', 'kindling')).toBe(false);
    expect(mentions('The pre-kindling step.', 'kindling')).toBe(false);
    expect(mentions('Kindling shipped.', 'kindling')).toBe(true);
    expect(mentions('kindling-splash shipped.', 'kindling-splash')).toBe(true);
    expect(mentions('rekindling', 'kindling')).toBe(false);
    expect(mentions('the apple\npie', 'Apple Pie')).toBe(true);
    expect(mentions('C++ notes', 'C++')).toBe(true);
  });
});
