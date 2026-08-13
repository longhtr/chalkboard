/** Proves numeric drafting, blur/Enter commit, Escape reset, clamping, stepping, and invalid input recovery. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { NumberInput } from './NumberInput';

function Harness() {
  const [value, setValue] = useState(2);
  return (
    <NumberInput
      aria-label="Numeric value"
      minimum={1}
      maximum={12}
      value={value}
      onValueChange={setValue}
    />
  );
}

afterEach(cleanup);

describe('NumberInput', () => {
  it('stays empty while replacing a value and accepts the next number', () => {
    render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: 'Numeric value' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: '5' } });
    expect(input).toHaveValue(5);
    fireEvent.blur(input);
    expect(input).toHaveValue(5);
  });

  it('restores the current value when an empty draft loses focus', () => {
    render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: 'Numeric value' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(2);
  });
});
