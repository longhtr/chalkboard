/** Proves the phone inspector disclosure without changing editor behavior. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StylePanel } from './StylePanel';

afterEach(cleanup);

describe('StylePanel', () => {
  it('opens and closes its mobile control drawer', () => {
    render(
      <StylePanel
        editingEquation={false}
        inputMode="text"
        onInputModeChange={vi.fn()}
        showInputMode={false}
      >
        <span>Stroke color</span>
      </StylePanel>,
    );

    const panel = screen.getByRole('complementary', { name: 'Element style' });
    fireEvent.click(screen.getByRole('button', { name: 'Open element style' }));
    expect(panel).toHaveClass('is-open');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close element style' }),
    );
    expect(panel).not.toHaveClass('is-open');
  });
});
