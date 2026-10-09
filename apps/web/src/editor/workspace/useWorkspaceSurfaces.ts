/**
 * Owns board-menu, settings, dialog, and object-navigator visibility. It also
 * centralizes global Escape handling and board-menu focus restoration.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

interface WorkspaceSurfaces {
  closeObjectNavigator(): void;
  exportOpen: boolean;
  fontSettingsOpen: boolean;
  gridSettingsOpen: boolean;
  latexCheatsheetOpen: boolean;
  menuOpen: boolean;
  modalOpen: boolean;
  newBoardOptionsOpen: boolean;
  objectNavigatorOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  setFontSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setGridSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setLatexCheatsheetOpen: Dispatch<SetStateAction<boolean>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setNewBoardOptionsOpen: Dispatch<SetStateAction<boolean>>;
  setObjectNavigatorOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setThemeSettingsOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsOpen: boolean;
  suppressNextBoardMenuFocusRestoration(): void;
  themeSettingsOpen: boolean;
}

/** Owns workspace surface visibility, Escape handling, and focus restoration. */
export function useWorkspaceSurfaces(): WorkspaceSurfaces {
  const boardSurfaceWasOpenRef = useRef(false);
  const restoreBoardMenuFocusRef = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newBoardOptionsOpen, setNewBoardOptionsOpen] = useState(false);
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false);
  const [fontSettingsOpen, setFontSettingsOpen] = useState(false);
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [latexCheatsheetOpen, setLatexCheatsheetOpen] = useState(false);
  const [objectNavigatorOpen, setObjectNavigatorOpen] = useState(false);
  const closeObjectNavigator = useCallback(() => {
    setObjectNavigatorOpen(false);
  }, []);
  const suppressNextBoardMenuFocusRestoration = useCallback(() => {
    restoreBoardMenuFocusRef.current = false;
  }, []);

  useEffect(() => {
    const boardSurfaceOpen =
      exportOpen || shortcutsOpen || latexCheatsheetOpen || objectNavigatorOpen;
    if (boardSurfaceOpen) {
      boardSurfaceWasOpenRef.current = true;
      return;
    }
    if (!boardSurfaceWasOpenRef.current) return;
    boardSurfaceWasOpenRef.current = false;
    const restoreFocus = restoreBoardMenuFocusRef.current;
    restoreBoardMenuFocusRef.current = true;
    if (!restoreFocus) return;
    const focusFrame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Open board menu"]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [exportOpen, latexCheatsheetOpen, objectNavigatorOpen, shortcutsOpen]);

  useEffect(() => {
    if (!shortcutsOpen && !latexCheatsheetOpen && !exportOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShortcutsOpen(false);
      setLatexCheatsheetOpen(false);
      setExportOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [exportOpen, latexCheatsheetOpen, shortcutsOpen]);

  return {
    closeObjectNavigator,
    exportOpen,
    fontSettingsOpen,
    gridSettingsOpen,
    latexCheatsheetOpen,
    menuOpen,
    modalOpen: shortcutsOpen || latexCheatsheetOpen || exportOpen,
    newBoardOptionsOpen,
    objectNavigatorOpen,
    setExportOpen,
    setFontSettingsOpen,
    setGridSettingsOpen,
    setLatexCheatsheetOpen,
    setMenuOpen,
    setNewBoardOptionsOpen,
    setObjectNavigatorOpen,
    setShortcutsOpen,
    setThemeSettingsOpen,
    shortcutsOpen,
    suppressNextBoardMenuFocusRestoration,
    themeSettingsOpen,
  };
}
