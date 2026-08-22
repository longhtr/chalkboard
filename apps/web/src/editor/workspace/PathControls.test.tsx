/** Proves each path sub-control emits its semantic value and appears only for compatible path modes. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PathControls } from './PathControls';

describe('PathControls', () => {
  it('shows the Space continuation hint only for Straight paths', () => {
    const props = {
      allowFreehand: true,
      fit: { accuracy: 3, continuity: 'c1' as const, maxSegments: 8 },
      manualMaximum: 8,
      onAccuracyChange: vi.fn(),
      onContinuityChange: vi.fn(),
      onManualMaximumChange: vi.fn(),
      onPathChange: vi.fn(),
      onToggleAutomaticMaximum: vi.fn(),
      pathKind: 'straight' as const,
      showFittingControls: true,
    };
    const { rerender } = render(<PathControls {...props} />);

    expect(screen.getByRole('note')).toHaveTextContent(
      'While drawing, press Space or tap with a second finger to add another segment. Hold the second finger to constrain the angle.',
    );
    expect(screen.getByText('Space')).toBeVisible();

    rerender(<PathControls {...props} pathKind="orthogonal" />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('offers exclusive C0, C1, and C2 fitting with C1 selected', () => {
    const onContinuityChange = vi.fn();
    const props = {
      allowFreehand: true,
      fit: { accuracy: 3, continuity: 'c1' as const, maxSegments: 8 },
      manualMaximum: 8,
      onAccuracyChange: vi.fn(),
      onContinuityChange,
      onManualMaximumChange: vi.fn(),
      onPathChange: vi.fn(),
      onToggleAutomaticMaximum: vi.fn(),
      pathKind: 'bezier' as const,
      showFittingControls: true,
    };
    const { rerender } = render(<PathControls {...props} />);

    expect(
      screen.getByRole('group', { name: 'Spline continuity' }),
    ).toBeVisible();
    const c0 = screen.getByRole('button', {
      name: 'Use C0 spline continuity',
    });
    const c1 = screen.getByRole('button', {
      name: 'Use C1 spline continuity',
    });
    const c2 = screen.getByRole('button', {
      name: 'Use C2 spline continuity',
    });
    expect(c0).toHaveAttribute('aria-pressed', 'false');
    expect(c1).toHaveAttribute('aria-pressed', 'true');
    expect(c2).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Maximum curves' })).toBeVisible();

    fireEvent.click(c0);
    fireEvent.click(c2);
    expect(onContinuityChange).toHaveBeenNthCalledWith(1, 'c0');
    expect(onContinuityChange).toHaveBeenNthCalledWith(2, 'c2');

    rerender(
      <PathControls
        {...props}
        fit={{ accuracy: 3, continuity: 'c2', maxSegments: null }}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Maximum curves slider' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('slider', {
        name: 'Automatic fitting accuracy slider',
      }),
    ).toBeVisible();
  });
});
