/** Proves blocked localStorage falls back to bounded memory and preserves remove/clear semantics. */
import { describe, expect, it } from 'vitest';

import { createBestEffortStorage } from './bestEffortStorage';

describe('best-effort browser storage', () => {
  it('survives storage access that throws during startup', () => {
    const storage = createBestEffortStorage(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(storage.getItem('choice')).toBeNull();
    expect(storage.setItem('choice', 'source')).toBe(false);
    expect(storage.getItem('choice')).toBe('source');
    expect(storage.removeItem('choice')).toBe(false);
    expect(storage.getItem('choice')).toBeNull();
  });

  it('retains the latest page-local value and flushes it after recovery', () => {
    const values = new Map([['choice', 'stale']]);
    let blocked = true;
    const storage = createBestEffortStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        if (blocked) throw new DOMException('blocked', 'SecurityError');
        values.delete(key);
      },
      setItem: (key, value) => {
        if (blocked) throw new DOMException('full', 'QuotaExceededError');
        values.set(key, value);
      },
    }));

    storage.setItem('choice', 'rendered');
    expect(storage.getItem('choice')).toBe('rendered');
    expect(values.get('choice')).toBe('stale');

    blocked = false;
    expect(storage.getItem('choice')).toBe('rendered');
    expect(values.get('choice')).toBe('rendered');

    blocked = true;
    storage.removeItem('choice');
    expect(storage.getItem('choice')).toBeNull();
    blocked = false;
    expect(storage.getItem('choice')).toBeNull();
    expect(values.has('choice')).toBe(false);
  });

  it('bounds fallback entry count and individual value size', () => {
    const storage = createBestEffortStorage(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    for (let index = 0; index < 65; index += 1) {
      storage.setItem(`key-${index}`, `value-${index}`);
    }
    expect(storage.getItem('key-0')).toBeNull();
    expect(storage.getItem('key-64')).toBe('value-64');

    storage.setItem('oversized', 'x'.repeat(64 * 1024 + 1));
    expect(storage.getItem('oversized')).toBeNull();
  });
});
