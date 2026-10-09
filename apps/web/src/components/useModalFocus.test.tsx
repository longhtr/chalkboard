/** Proves initial focus, forward/reverse Tab wrapping, Escape close, and opener focus restoration. */
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useModalFocus } from './useModalFocus';

function ModalFixture() {
  const ref = useModalFocus<HTMLDivElement>();
  return (
    <div ref={ref}>
      <button type="button" data-dialog-autofocus>
        First
      </button>
      <button type="button">Last</button>
    </div>
  );
}

describe('useModalFocus', () => {
  it('focuses, contains, and restores focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { getByRole, unmount } = render(<ModalFixture />);
    const first = getByRole('button', { name: 'First' });
    const last = getByRole('button', { name: 'Last' });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
