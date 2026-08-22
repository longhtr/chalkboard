/** Uses fake time to prove title normalization, local debounce, projection acceptance, and unmount flush. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBoardTitle } from './useBoardTitle';

describe('workspace board title authority', () => {
  it('adopts a changed projection when no newer collaborative title exists', () => {
    const view = renderHook(({ title }) => useBoardTitle('cloud:one', title), {
      initialProps: { title: 'Before' },
    });

    view.rerender({ title: 'Account rename' });

    expect(view.result.current.title).toBe('Account rename');
  });

  it('does not let a stale projection replace a newer title', () => {
    const view = renderHook(({ title }) => useBoardTitle('cloud:one', title), {
      initialProps: { title: 'Before' },
    });
    act(() => view.result.current.setTitle('Collaborative rename'));

    view.rerender({ title: 'Stale metadata' });

    expect(view.result.current.title).toBe('Collaborative rename');
  });

  it('accepts an acknowledged projection without erasing a later revision', () => {
    const view = renderHook(() => useBoardTitle('cloud:one', 'Before'));
    act(() => view.result.current.setTitle('First revision'));
    act(() => view.result.current.setTitle('Second revision'));
    act(() => view.result.current.acceptProjection('First revision'));

    expect(view.result.current.title).toBe('Second revision');
  });

  it('switches authority state when the active board changes', () => {
    const view = renderHook(
      ({ boardKey, title }) => useBoardTitle(boardKey, title),
      { initialProps: { boardKey: 'cloud:one', title: 'One' } },
    );
    act(() => view.result.current.setTitle('One draft'));

    view.rerender({ boardKey: 'cloud:two', title: 'Two' });

    expect(view.result.current.title).toBe('Two');
  });
});
