/** Proves one shared observer dispatches per-element callbacks and disconnects after final removal. */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('observeStaticMathResize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shares one observer and routes entries to their owning callbacks', async () => {
    const observed = new Set<Element>();
    let notify: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    const observe = vi.fn((element: Element) => observed.add(element));
    const unobserve = vi.fn((element: Element) => observed.delete(element));
    const constructor = vi.fn(function (callback: ResizeObserverCallback) {
      notify = callback;
      return { disconnect, observe, unobserve };
    });
    vi.stubGlobal('ResizeObserver', constructor);
    const { observeStaticMathResize } = await import('./sharedResizeObserver');
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const stopFirst = observeStaticMathResize(first, firstCallback);
    const stopSecond = observeStaticMathResize(second, secondCallback);
    notify(
      [
        { target: first },
        { target: second },
      ] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );

    expect(constructor).toHaveBeenCalledOnce();
    expect(observed).toEqual(new Set([first, second]));
    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledOnce();

    stopFirst();
    stopSecond();
    expect(unobserve).toHaveBeenCalledTimes(2);
    expect(observed.size).toBe(0);
  });
});
