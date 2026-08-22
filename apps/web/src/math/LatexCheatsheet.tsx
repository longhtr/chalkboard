/** Searchable, keyboard-accessible LaTeX reference dialog; reference data remains in `latexReference.ts`. */
import { convertLatexToMarkup } from 'mathlive';
import { useMemo, useState } from 'react';

import { useModalFocus } from '../components/useModalFocus';
import { decorateExcalifontStaticMarkup } from './excalifontLayout';
import { LATEX_REFERENCE_SECTIONS } from './latexReference';

function LatexPreview({ latex }: { latex: string }) {
  const markup = useMemo(() => {
    try {
      // The same decoration every inactive block gets. Without it the layout
      // corrections have nothing to match, so a reader comparing an example
      // here against what the board draws sees two different renderings of the
      // one command. The hooks are inert under the classic face, which is why
      // they can be added without knowing which font is selected.
      return decorateExcalifontStaticMarkup(convertLatexToMarkup(latex));
    } catch {
      return '';
    }
  }, [latex]);
  return (
    <span
      className="latex-cheatsheet-entry__preview"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

interface LatexCheatsheetProps {
  onClose(): void;
}

/** Searchable syntax-reference dialog with rendered examples. */
export function LatexCheatsheet({ onClose }: LatexCheatsheetProps) {
  const [query, setQuery] = useState('');
  const dialogRef = useModalFocus<HTMLElement>();
  const visibleSections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === '') return LATEX_REFERENCE_SECTIONS;
    return LATEX_REFERENCE_SECTIONS.map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        `${section.title} ${entry.description} ${entry.latex}`
          .toLowerCase()
          .includes(normalized),
      ),
    })).filter((section) => section.entries.length > 0);
  }, [query]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcuts-dialog latex-cheatsheet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="latex-cheatsheet-title"
      >
        <header className="shortcuts-dialog__header">
          <div>
            <h2 id="latex-cheatsheet-title">MathLive / LaTeX cheatsheet</h2>
            <p>Type a command in Math mode, then press Space to complete it.</p>
          </div>
          <button
            type="button"
            className="shortcuts-dialog__close"
            aria-label="Close MathLive / LaTeX cheatsheet"
            data-dialog-autofocus
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="latex-cheatsheet-tips" aria-label="Math editing tips">
          <span>
            <kbd>Ctrl / ⌘</kbd> + <kbd>M</kbd> switches Math/Text mode
          </span>
          <span>
            <kbd>Space</kbd> completes a command
          </span>
          <span>
            <kbd>Tab</kbd> moves through placeholders
          </span>
          <span>
            <kbd>Enter</kbd> starts a new line
          </span>
        </div>

        <label className="latex-cheatsheet-search">
          <span>Search commands and topics</span>
          <input
            type="search"
            aria-label="Search MathLive / LaTeX cheatsheet"
            placeholder="Try fraction, vector, \\alpha…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>

        {visibleSections.length === 0 ? (
          <p className="latex-cheatsheet-empty" role="status">
            No matching commands. Try a broader term.
          </p>
        ) : (
          <div className="latex-cheatsheet-sections">
            {visibleSections.map((section) => (
              <section className="latex-cheatsheet-section" key={section.title}>
                <h3>{section.title}</h3>
                <div className="latex-cheatsheet-entries">
                  {section.entries.map((entry) => (
                    <div
                      className="latex-cheatsheet-entry"
                      key={entry.description}
                    >
                      <div>
                        <span className="latex-cheatsheet-entry__description">
                          {entry.description}
                        </span>
                        <code>{entry.latex}</code>
                      </div>
                      <LatexPreview latex={entry.latex} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
