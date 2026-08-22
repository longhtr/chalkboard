/** Central named SVG icon set; callers provide accessible labels through their owning controls. */
import type { SVGProps } from 'react';

/** Closed icon identifiers available to controls and tool metadata. */
export type IconName =
  | 'account'
  | 'arrow'
  | 'curve'
  | 'double-arrow'
  | 'diamond'
  | 'draw'
  | 'ellipse'
  | 'equation'
  | 'export'
  | 'folder-open'
  | 'grid'
  | 'hand'
  | 'image'
  | 'import'
  | 'info'
  | 'line'
  | 'hexagon'
  | 'keyboard'
  | 'menu'
  | 'new-board'
  | 'orthogonal'
  | 'parallelogram'
  | 'pentagon'
  | 'redo'
  | 'rectangle'
  | 'selection'
  | 'star'
  | 'text'
  | 'theme'
  | 'trapezoid'
  | 'triangle'
  | 'trash'
  | 'undo'
  | 'upload';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

/** Renders one decorative current-color SVG icon by stable identifier. */
export function Icon({ name, size = 18, ...props }: IconProps) {
  const commonProps = {
    'aria-hidden': true,
    fill: 'none',
    height: size,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: size,
    ...props,
  };

  switch (name) {
    case 'account':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...commonProps}>
          <path d="M12 21V9" />
          <path d="m7 14 5-5 5 5" />
          <path d="M4 4h16" />
        </svg>
      );
    case 'new-board':
      return (
        <svg {...commonProps}>
          <rect height="17" rx="2" width="15" x="4.5" y="3.5" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case 'folder-open':
      return (
        <svg {...commonProps}>
          <path d="M3 7.5V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" />
          <path d="M3.5 10h18l-2.5 10H5.5L3.5 10Z" />
        </svg>
      );
    case 'import':
      return (
        <svg {...commonProps}>
          <path d="M5 3h9l5 5v13H5V3Z" />
          <path d="M14 3v5h5" />
          <path d="M12 10v7" />
          <path d="m9 14 3 3 3-3" />
        </svg>
      );
    case 'export':
      return (
        <svg {...commonProps}>
          <path d="M5 3h9l5 5v13H5V3Z" />
          <path d="M14 3v5h5" />
          <path d="M9 14h7" />
          <path d="m13 11 3 3-3 3" />
        </svg>
      );
    case 'selection':
      return (
        <svg {...commonProps}>
          <path d="m5 3 14 8-6.2 2.1L10 19 5 3Z" />
        </svg>
      );
    case 'hand':
      return (
        <svg {...commonProps}>
          <path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10" />
          <path d="M10.5 10V4.8a1.5 1.5 0 0 1 3 0V10" />
          <path d="M13.5 10V6a1.5 1.5 0 0 1 3 0v5" />
          <path d="M16.5 10V8.3a1.5 1.5 0 0 1 3 0v4.2c0 5.3-2.8 8.5-7.2 8.5-2.6 0-4.2-1.1-5.6-3L4 14.4a1.7 1.7 0 0 1 2.6-2.1L9 14" />
        </svg>
      );
    case 'rectangle':
      return (
        <svg {...commonProps}>
          <rect height="14" rx="1.5" width="16" x="4" y="5" />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...commonProps}>
          <path d="m12 4 9 16H3L12 4Z" />
        </svg>
      );
    case 'ellipse':
      return (
        <svg {...commonProps}>
          <ellipse cx="12" cy="12" rx="9" ry="7" />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...commonProps}>
          <path d="m12 3 9 9-9 9-9-9 9-9Z" />
        </svg>
      );
    case 'pentagon':
      return (
        <svg {...commonProps}>
          <path d="m12 3 9 7-3.5 11h-11L3 10l9-7Z" />
        </svg>
      );
    case 'hexagon':
      return (
        <svg {...commonProps}>
          <path d="m7 3 10 0 5 9-5 9H7l-5-9 5-9Z" />
        </svg>
      );
    case 'parallelogram':
      return (
        <svg {...commonProps}>
          <path d="M7 4h15l-5 16H2L7 4Z" />
        </svg>
      );
    case 'trapezoid':
      return (
        <svg {...commonProps}>
          <path d="M7 4h10l5 16H2L7 4Z" />
        </svg>
      );
    case 'star':
      return (
        <svg {...commonProps}>
          <path d="m12 2.5 2.9 6 6.6 1-4.8 4.7 1.1 6.7-5.8-3.2-5.8 3.2 1.1-6.7-4.8-4.7 6.6-1 2.9-6Z" />
        </svg>
      );
    case 'line':
      return (
        <svg {...commonProps}>
          <path d="m5 19 14-14" />
        </svg>
      );
    case 'curve':
      return (
        <svg {...commonProps}>
          <path d="M3 17C8 5 16 19 21 7" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...commonProps}>
          <path d="M5 19 19 5" />
          <path d="M11 5h8v8" />
        </svg>
      );
    case 'orthogonal':
      return (
        <svg {...commonProps}>
          <path d="M4 17h7V7h7" />
        </svg>
      );
    case 'double-arrow':
      return (
        <svg {...commonProps}>
          <path d="M5 19 19 5" />
          <path d="M11 5h8v8" />
          <path d="M13 19H5v-8" />
        </svg>
      );
    case 'draw':
      return (
        <svg {...commonProps}>
          <path d="M3 17c3-7 5 3 8-4s4 4 10-5" />
        </svg>
      );
    case 'equation':
      return (
        <svg {...commonProps}>
          <path d="M18 5H8l5 7-5 7h10" />
        </svg>
      );
    case 'text':
      return (
        <svg {...commonProps}>
          <path d="M5 5h14M12 5v14M8 19h8" />
        </svg>
      );
    case 'theme':
      // A circle half filled with its own stroke color reads as contrast.
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'info':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m7 7 1 13h8l1-13" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...commonProps}>
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      );
    case 'image':
      return (
        <svg {...commonProps}>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <circle cx="8" cy="9" r="1.5" />
          <path d="m5 18 5-5 3 3 2-2 4 4" />
        </svg>
      );
    case 'keyboard':
      return (
        <svg {...commonProps}>
          <rect height="13" rx="2" width="20" x="2" y="6" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h8" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...commonProps}>
          <circle cx="6" cy="6" fill="currentColor" r="1" stroke="none" />
          <circle cx="12" cy="6" fill="currentColor" r="1" stroke="none" />
          <circle cx="18" cy="6" fill="currentColor" r="1" stroke="none" />
          <circle cx="6" cy="12" fill="currentColor" r="1" stroke="none" />
          <circle cx="12" cy="12" fill="currentColor" r="1" stroke="none" />
          <circle cx="18" cy="12" fill="currentColor" r="1" stroke="none" />
          <circle cx="6" cy="18" fill="currentColor" r="1" stroke="none" />
          <circle cx="12" cy="18" fill="currentColor" r="1" stroke="none" />
          <circle cx="18" cy="18" fill="currentColor" r="1" stroke="none" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...commonProps}>
          <path d="m9 7-5 5 5 5" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        </svg>
      );
    case 'redo':
      return (
        <svg {...commonProps}>
          <path d="m15 7 5 5-5 5" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        </svg>
      );
  }
}
