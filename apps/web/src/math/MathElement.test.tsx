/** Proves inactive rendering, safe fallback, detail policy, measurements, accessibility labels, and font changes. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MathElement } from './MathElement';

const baseElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  fontSize: 30,
  height: 40,
  id: 'dense-math',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: String.raw`Area is $A=\pi r^2$`,
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'equation' as const,
  width: 120,
  x: 10,
  y: 20,
};

describe('MathElement', () => {
  it('uses a bounded accessible source preview when dense rendering is simplified', () => {
    render(
      <MathElement
        camera={{ x: 0, y: 0, zoom: 1 }}
        element={baseElement}
        onMeasure={vi.fn()}
        simplified
      />,
    );

    const preview = screen.getByRole('group', {
      name: String.raw`Area is $A=\pi r^2$`,
    });
    expect(preview).toHaveClass('is-simplified');
    expect(preview).toHaveAttribute('data-render-detail', 'simplified');
    expect(preview).toHaveTextContent(String.raw`Area is $A=\pi r^2$`);
    expect(preview.querySelector('.ML__latex')).toBeNull();
  });

  it('inherits the base color without writing it onto every markup node', () => {
    const { container } = render(
      <MathElement
        camera={{ x: 0, y: 0, zoom: 1 }}
        element={baseElement}
        onMeasure={vi.fn()}
      />,
    );

    const content = container.querySelector('.mixed-text-element__content');
    if (content === null)
      throw new Error('Expected rendered mixed-text content');
    expect(
      [...content.querySelectorAll<HTMLElement>('*')].filter(
        (element) =>
          element.style.color !== '' ||
          element.style.getPropertyValue('--run-color') !== '',
      ),
    ).toEqual([]);
  });
});
