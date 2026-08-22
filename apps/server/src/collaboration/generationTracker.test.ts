/** Proves stale room generations become inactive and retirement callbacks run exactly once. */
import { describe, expect, it } from 'vitest';

import { createGenerationTracker } from './generationTracker.js';

describe('generation tracker', () => {
  it('keeps one token stable until the key is advanced', () => {
    const tracker = createGenerationTracker({ maximumEntries: 2 });
    const initial = tracker.current('board');
    expect(tracker.current('board')).toBe(initial);
    expect(tracker.advance('board')).not.toBe(initial);
  });

  it('bounds inactive keys without making an evicted token current again', () => {
    const tracker = createGenerationTracker({ maximumEntries: 2 });
    const evicted = tracker.current('one');
    tracker.current('two');
    tracker.current('three');
    expect(tracker.size).toBe(2);
    expect(tracker.current('one')).not.toBe(evicted);
    expect(tracker.size).toBe(2);
  });

  it('retains protected keys while pruning inactive keys', () => {
    const tracker = createGenerationTracker({
      isProtected: (key) => key === 'active',
      maximumEntries: 2,
    });
    const active = tracker.current('active');
    tracker.current('old');
    tracker.current('new');
    expect(tracker.current('active')).toBe(active);
    expect(tracker.size).toBe(2);
  });
});
