import { DEFAULT_ELEMENT_STYLE } from '@chalkboard/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StrokeControls } from './StrokeControls';

const callbacks = () => ({
  onArrowheadsChange: vi.fn(),
  onCornerRadiusChange: vi.fn(),
  onCornerRadiusGestureChange: vi.fn(),
  onStrokeDashGapChange: vi.fn(),
  onStrokeDashGapGestureChange: vi.fn(),
  onStyleChange: vi.fn(),
});

describe('StrokeControls', () => {
  it('shows a synchronized, dynamically named gap control for patterned strokes', () => {
    const handlers = callbacks();
    const props = {
      ...handlers,
      arrowheads: 'none' as const,
      cornerRadius: 0,
      isLine: true,
      isOrthogonalLine: false,
      isShape: false,
      shapeKind: 'rectangle' as const,
      style: DEFAULT_ELEMENT_STYLE,
    };
    const { rerender } = render(<StrokeControls {...props} />);

    expect(screen.queryByText('Gap between dots')).toBeNull();
    expect(screen.queryByText('Gap between dashes')).toBeNull();

    rerender(
      <StrokeControls
        {...props}
        style={{ ...DEFAULT_ELEMENT_STYLE, strokeStyle: 'dotted' }}
      />,
    );
    const dotSlider = screen.getByRole('slider', {
      name: 'Gap between dots slider',
    });
    expect(dotSlider).toHaveValue('5');
    expect(
      screen.getByRole('spinbutton', { name: 'Gap between dots value' }),
    ).toHaveValue(5);
    fireEvent.change(dotSlider, { target: { value: '17' } });
    expect(handlers.onStrokeDashGapChange).toHaveBeenLastCalledWith(17);

    rerender(
      <StrokeControls
        {...props}
        style={{
          ...DEFAULT_ELEMENT_STYLE,
          strokeDashGap: 17,
          strokeStyle: 'dashed',
        }}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Gap between dashes slider' }),
    ).toHaveValue('17');
    expect(
      screen.getByRole('spinbutton', { name: 'Gap between dashes value' }),
    ).toHaveValue(17);
  });
});
