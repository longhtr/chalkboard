/** Proves a peer's selection is outlined the way its own selector sees it. */
import type { BoardElement } from '@chalkboard/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CollaborationOverlay } from './CollaborationOverlay';
import type { CloudCollaborator } from '../../collaboration/useCloudBoard';

const camera = { x: 0, y: 0, zoom: 1 };

const base = {
  backgroundColor: 'transparent',
  createdBy: 'peer',
  height: 40,
  opacity: 1,
  rotation: 0,
  strokeColor: '#111827',
  strokeWidth: 2,
  width: 100,
  x: 10,
  y: 20,
} as const;

function shape(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    ...base,
    cornerRadius: 0,
    id: 'shape-1',
    shapeKind: 'rectangle',
    type: 'shape',
    ...overrides,
  } as BoardElement;
}

function collaborator(
  selection: string[],
  cursor?: { x: number; y: number },
): CloudCollaborator[] {
  return [
    {
      clientId: 7,
      color: '#4c6ef5',
      name: 'Grace',
      selection,
      userId: 'peer-1',
      ...(cursor === undefined ? {} : { cursor }),
    },
  ];
}

describe('CollaborationOverlay', () => {
  afterEach(cleanup);

  it('shows a symmetric stemless pointer for a collaborator cursor', () => {
    const { container } = render(
      <CollaborationOverlay
        camera={camera}
        collaborators={collaborator([], { x: 12, y: 18 })}
        elements={[]}
      />,
    );

    const pointer = container.querySelector('.collaborator-cursor-pointer');
    expect(pointer).toBeInstanceOf(SVGSVGElement);
    expect(pointer?.querySelector('path')).toHaveAttribute(
      'd',
      'M1 1 7 14 14 7Z',
    );
    expect(pointer).not.toHaveTextContent('◆');
    expect(screen.getByText('Grace')).toBeVisible();
  });

  it('turns the outline with a turned object', () => {
    render(
      <CollaborationOverlay
        camera={camera}
        collaborators={collaborator(['shape-1'])}
        elements={[shape({ rotation: 30 })]}
      />,
    );

    // The upright bounds, turned about their own middle: an enclosing
    // rectangle would be wider and taller than the object it outlines.
    const outline = screen.getByTitle("Grace's selection");
    expect(outline).toHaveStyle({ height: '40px', width: '100px' });
    expect(outline.style.transform).toContain('rotate(30deg)');
    // The overlay turns about its top-left corner, so a turn has to be walked
    // to the middle and back or the outline drifts off the object it marks.
    expect(outline.style.transform).toContain('translate(50px, 20px)');
    expect(outline.style.transform).toContain('translate(-50px, -20px)');
  });

  it('leaves an unturned object without a rotation', () => {
    render(
      <CollaborationOverlay
        camera={camera}
        collaborators={collaborator(['shape-1'])}
        elements={[shape()]}
      />,
    );

    expect(
      screen.getByTitle("Grace's selection").style.transform,
    ).not.toContain('rotate');
  });

  it('encloses a group upright, as its own selector sees it', () => {
    render(
      <CollaborationOverlay
        camera={camera}
        collaborators={collaborator(['shape-1', 'shape-2'])}
        elements={[
          shape({ rotation: 30 }),
          shape({ id: 'shape-2', x: 300, y: 200 }),
        ]}
      />,
    );

    // Turning a group would spin every member about a shared centre, which is
    // not what selecting several objects shows, so the frame stays upright.
    expect(
      screen.getByTitle("Grace's selection").style.transform,
    ).not.toContain('rotate');
  });
});
