/**
 * Shared jsdom test environment. It installs DOM matchers and deterministic
 * browser API shims that individual suites may override and restore explicitly.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class ResizeObserverMock {
  disconnect(): void {
    return undefined;
  }

  observe(): void {
    return undefined;
  }

  unobserve(): void {
    return undefined;
  }
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(() => null),
});
Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
  configurable: true,
  value: vi.fn(() => false),
});
