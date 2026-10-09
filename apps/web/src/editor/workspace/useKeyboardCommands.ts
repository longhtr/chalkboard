/**
 * Installs one stable document key listener while refs supply current semantic
 * commands and modal/input ownership, avoiding listener churn per render.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

import {
  handleKeyboardCommand,
  type KeyboardCommandOptions,
} from '../interaction/keyboardCommands';

/** Installs the semantic workspace keydown dispatcher with current options. */
export function useKeyboardCommands(options: KeyboardCommandOptions): void {
  const optionsRef = useRef(options);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      handleKeyboardCommand(event, optionsRef.current);
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, []);
}
