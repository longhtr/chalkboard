import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShapeControls } from './ShapeControls';

describe('ShapeControls', () => {
  it('shows a circular two-ended arc control only for ellipses', () => {
    const onChange = vi.fn();
    const onEllipseAngleChange = vi.fn();
    const onEllipseAngleGestureChange = vi.fn();
    const props = {
      ellipseEndAngle: 360,
      ellipseStartAngle: 0,
      onChange,
      onEllipseAngleChange,
      onEllipseAngleGestureChange,
      shapeKind: 'rectangle' as const,
      showKindOptions: true,
    };
    const { rerender } = render(<ShapeControls {...props} />);

    expect(
      screen.queryByRole('group', { name: 'Ellipse arc range' }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use circle / ellipse shape' }),
    );
    expect(onChange).toHaveBeenCalledWith('ellipse');

    rerender(
      <ShapeControls
        {...props}
        ellipseEndAngle={180}
        ellipseStartAngle={30}
        shapeKind="ellipse"
      />,
    );
    const start = screen.getByRole('slider', {
      name: 'Arc start angle slider',
    });
    const end = screen.getByRole('slider', {
      name: 'Arc end angle slider',
    });
    expect(start).toHaveValue('30');
    expect(start).toHaveAttribute('min', '0');
    expect(start).toHaveAttribute('max', '360');
    expect(end).toHaveValue('180');
    expect(end).toHaveAttribute('min', '0');
    expect(end).toHaveAttribute('max', '360');
    expect(
      screen.getByRole('spinbutton', { name: 'Arc start angle' }),
    ).toHaveValue(30);
    expect(
      screen.getByRole('spinbutton', { name: 'Arc end angle' }),
    ).toHaveValue(180);

    fireEvent.change(start, { target: { value: '45' } });
    fireEvent.change(end, { target: { value: '225' } });
    expect(onEllipseAngleChange).toHaveBeenNthCalledWith(1, {
      startAngle: 45,
    });
    expect(onEllipseAngleChange).toHaveBeenNthCalledWith(2, { endAngle: 225 });

    rerender(
      <ShapeControls
        {...props}
        ellipseEndAngle={60}
        ellipseStartAngle={300}
        shapeKind="ellipse"
      />,
    );
    expect(
      screen
        .getByRole('slider', { name: 'Arc start angle slider' })
        .closest('.dual-range'),
    ).toHaveClass('is-wrapped');

    rerender(
      <ShapeControls {...props} shapeKind="ellipse" showKindOptions={false} />,
    );
    expect(screen.queryByRole('group', { name: 'Shape' })).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Ellipse arc range' }),
    ).toBeVisible();
  });
});
