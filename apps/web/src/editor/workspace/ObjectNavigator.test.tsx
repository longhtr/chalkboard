/** Exercises semantic labels, search, pagination, selection, ordering, position editing, and announcements. */
import type { BoardElement } from '@chalkboard/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { ObjectNavigator } from './ObjectNavigator';

const elements: BoardElement[] = [
  {
    backgroundColor: 'transparent',
    cornerRadius: 0,
    createdBy: 'local',
    height: 80,
    id: 'shape',
    opacity: 1,
    rotation: 0,
    shapeKind: 'rectangle',
    strokeColor: '#1f2937',
    strokeWidth: 2,
    type: 'shape',
    width: 120,
    x: 10.4,
    y: 20.6,
  },
  {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 25,
    height: 30,
    id: 'text',
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source: 'Area is $A=\\pi r^2$',
    strokeColor: '#1f2937',
    strokeWidth: 2,
    type: 'equation',
    width: 160,
    x: -15,
    y: 42,
  },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ObjectNavigator', () => {
  it('lists topmost objects first and supports selection and order commands', () => {
    const onCenterObject = vi.fn();
    const onDeleteSelected = vi.fn();
    const onMoveSelected = vi.fn();
    const onSelect = vi.fn();
    render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={onCenterObject}
        onClose={vi.fn()}
        onDeleteSelected={onDeleteSelected}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={onMoveSelected}
        onSelect={onSelect}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set(['shape'])}
      />,
    );

    expect(screen.getByText('2 objects')).toBeInTheDocument();
    expect(screen.queryByText('Topmost first')).not.toBeInTheDocument();
    const text = screen.getByRole('button', {
      name: 'Mixed text block, object 1, position -15, 42',
    });
    const shape = screen.getByRole('button', {
      name: 'Rectangle shape, object 2, position 10, 21',
    });
    expect(shape).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Area is $A=\\pi r^2$')).toBeInTheDocument();

    fireEvent.click(shape);
    fireEvent.click(text, { shiftKey: true });
    expect(onSelect).toHaveBeenNthCalledWith(1, 'shape', 'replace');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'text', 'toggle');
    expect(onCenterObject).toHaveBeenNthCalledWith(1, 'shape');
    expect(onCenterObject).toHaveBeenNthCalledWith(2, 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Move up one' }));
    expect(onMoveSelected).toHaveBeenCalledWith('forward');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onDeleteSelected).toHaveBeenCalledOnce();

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onDeleteSelected).toHaveBeenCalledOnce();
    input.remove();
  });

  it('searches object types and mixed-text content without changing the board', () => {
    render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Search objects' });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: 'pi r^2' } });
    expect(screen.getByText('1 of 2 objects shown')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Mixed text block, object 1, position -15, 42',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Rectangle shape, object/u }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'rectangle' } });
    expect(
      screen.getByRole('button', {
        name: 'Rectangle shape, object 2, position 10, 21',
      }),
    ).toBeVisible();

    fireEvent.change(search, { target: { value: 'photograph' } });
    expect(screen.getByText('No objects match “photograph”.')).toBeVisible();
  });

  it('sorts by vertical position without layer controls or dragging', () => {
    const onCenterObject = vi.fn();
    render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={onCenterObject}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set(['shape'])}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by vertical position' }),
    );

    const first = screen.getByRole('button', {
      name: 'Rectangle shape, object 1, position 10, 21',
    });
    const second = screen.getByRole('button', {
      name: 'Mixed text block, object 2, position -15, 42',
    });
    expect(
      screen.queryByRole('heading', { name: 'Layer order' }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelectorAll('.object-navigator__drag-handle'),
    ).toHaveLength(0);
    expect(first.closest('li')).toHaveAttribute('draggable', 'false');

    fireEvent.click(second, { shiftKey: true });
    expect(onCenterObject).toHaveBeenCalledWith('text');
  });

  it('selects every object between the first and last selection', () => {
    const rangeElements: BoardElement[] = ['top', 'middle', 'bottom'].map(
      (id, index) => ({
        ...requiredTestValue(elements[0], 'first object fixture'),
        id,
        y: index * 100,
      }),
    );
    const onSelectRange = vi.fn();
    render(
      <ObjectNavigator
        elements={rangeElements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={onSelectRange}
        readOnly={false}
        selectedIds={new Set(['top', 'bottom'])}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by vertical position' }),
    );
    const selectBetween = screen.getByRole('button', {
      name: 'Select all between',
    });
    expect(selectBetween).toBeEnabled();
    fireEvent.click(selectBetween);
    expect(onSelectRange).toHaveBeenCalledWith(['top', 'middle', 'bottom']);
  });

  it('reveals an object selected on the board', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const props = {
        elements,
        onCenterObject: vi.fn(),
        onClose: vi.fn(),
        onDeleteSelected: vi.fn(),
        onDropAtEdge: vi.fn(),
        onDropSelected: vi.fn(),
        onMoveSelected: vi.fn(),
        onSelect: vi.fn(),
        onSelectRange: vi.fn(),
        readOnly: false,
      };
      const { rerender } = render(
        <ObjectNavigator {...props} selectedIds={new Set()} />,
      );

      rerender(<ObjectNavigator {...props} selectedIds={new Set(['shape'])} />);

      expect(
        screen.getByRole('button', {
          name: 'Rectangle shape, object 2, position 10, 21',
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it('drags the current selection before or after another object', () => {
    const onDropAtEdge = vi.fn();
    const onDropSelected = vi.fn();
    const { container } = render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={onDropAtEdge}
        onDropSelected={onDropSelected}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set(['shape'])}
      />,
    );
    const shapeEntry = screen
      .getByRole('button', {
        name: 'Rectangle shape, object 2, position 10, 21',
      })
      .closest('li');
    const textEntry = screen
      .getByRole('button', {
        name: 'Mixed text block, object 1, position -15, 42',
      })
      .closest('li');
    const requiredShapeEntry = requiredTestValue(
      shapeEntry,
      'shape navigator entry',
    );
    const requiredTextEntry = requiredTestValue(
      textEntry,
      'text navigator entry',
    );
    vi.spyOn(requiredTextEntry, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    });
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    };

    fireEvent.dragStart(requiredShapeEntry, { dataTransfer });
    for (const type of ['dragover', 'drop']) {
      const event = new MouseEvent(type, { bubbles: true, clientY: 10 });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      fireEvent(requiredTextEntry, event);
    }

    expect(onDropSelected).toHaveBeenCalledOnce();
    const [draggedIds, targetId, placement] = requiredTestValue(
      onDropSelected.mock.calls[0],
      'object drop callback',
    );
    expect([...draggedIds]).toEqual(['shape']);
    expect(targetId).toBe('text');
    expect(placement).toBe('before');

    const topEdge = requiredTestValue(
      container.querySelector('.object-navigator__drop-edge'),
      'top object-list drop edge',
    );
    fireEvent.dragStart(requiredShapeEntry, { dataTransfer });
    fireEvent.dragOver(topEdge, { dataTransfer });
    fireEvent.drop(topEdge, { dataTransfer });
    expect(onDropAtEdge).toHaveBeenCalledOnce();
    const edgeDrop = requiredTestValue(
      onDropAtEdge.mock.calls[0],
      'edge drop callback',
    );
    expect([...edgeDrop[0]]).toEqual(['shape']);
    expect(edgeDrop[1]).toBe('top');
  });

  it('shows reorder guidance only after hovering an object for one second', () => {
    vi.useFakeTimers();
    render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set()}
      />,
    );
    const entry = screen
      .getByRole('button', {
        name: 'Mixed text block, object 1, position -15, 42',
      })
      .closest('li');
    const requiredEntry = requiredTestValue(
      entry,
      'hovered object navigator entry',
    );

    fireEvent.mouseEnter(requiredEntry);
    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Shift-click to select multiple objects',
    );
    fireEvent.mouseLeave(requiredEntry);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('guides the vertical order too, without promising a drag it has not got', () => {
    vi.useFakeTimers();
    render(
      <ObjectNavigator
        elements={elements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by vertical position' }),
    );
    const entry = requiredTestValue(
      screen
        .getAllByRole('button', { name: /object 1, position/u })[0]
        ?.closest('li'),
      'hovered object navigator entry',
    );

    fireEvent.mouseEnter(entry);
    act(() => vi.advanceTimersByTime(1000));
    // The guidance appears here as it does under the layer order, but only the
    // layer order can be dragged, so this one says what this order actually
    // offers instead of describing a gesture that does nothing.
    const hint = screen.getByRole('tooltip');
    expect(hint).toHaveTextContent('Sorted from top to bottom');
    expect(hint).toHaveTextContent('Shift-click to select multiple objects');
    expect(hint).not.toHaveTextContent('Drag');
    fireEvent.mouseLeave(entry);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('virtualizes large boards in one continuous accessible object list', () => {
    const manyElements = Array.from({ length: 250 }, (_, index) => ({
      ...requiredTestValue(elements[0], 'first object fixture'),
      id: `shape-${index}`,
      x: index,
    }));
    render(
      <ObjectNavigator
        elements={manyElements}
        onCenterObject={vi.fn()}
        onClose={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set()}
      />,
    );

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button').length).toBeLessThan(30);
    const first = within(list).getByRole('button', {
      name: 'Rectangle shape, object 1, position 249, 21',
    });
    expect(first).toBeVisible();
    expect(first.closest('li')).toHaveAttribute('aria-posinset', '1');
    expect(first.closest('li')).toHaveAttribute('aria-setsize', '250');
    expect(list.querySelector('.object-navigator__virtual-spacer')).toHaveStyle(
      { height: '19028px' },
    );
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    list.scrollTop = 19_000;
    fireEvent.scroll(list);
    expect(
      within(list).getByRole('button', {
        name: 'Rectangle shape, object 250, position 0, 21',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('navigation', { name: 'Board object pages' }),
    ).not.toBeInTheDocument();
  });

  it('closes from Escape and reports an empty board', () => {
    const onClose = vi.fn();
    render(
      <ObjectNavigator
        elements={[]}
        onCenterObject={vi.fn()}
        onClose={onClose}
        onDeleteSelected={vi.fn()}
        onDropAtEdge={vi.fn()}
        onDropSelected={vi.fn()}
        onMoveSelected={vi.fn()}
        onSelect={vi.fn()}
        onSelectRange={vi.fn()}
        readOnly={false}
        selectedIds={new Set()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'This board has no objects yet.',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
