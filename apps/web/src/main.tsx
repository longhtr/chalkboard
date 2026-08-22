/** Browser entry: captures the original URL, installs fatal recovery, loads styles, and mounts `App`. */
import { createRoot } from 'react-dom/client';

import './math/mathLiveRuntime';
import { App } from './App';
import { DevelopmentEmailInboxPage } from './account/DevelopmentEmailInboxPage';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// The cascade runs from application foundations to specific board layers;
// responsive overrides remain last. Theme tokens come first so every later
// sheet resolves its colors against them.
import './styles/theme.css';
import './styles/foundation.css';
import './styles/account.css';
import './styles/workspace-shell.css';
import './styles/object-navigator.css';
import './styles/dialogs.css';
import './styles/toolbar.css';
import './styles/style-panel.css';
import './styles/viewport-controls.css';
import './styles/board-content.css';
import './styles/responsive.css';

const entryLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const root = document.querySelector('#root');

if (root === null) {
  throw new Error('Unable to find the application root');
}

const content =
  import.meta.env.DEV && window.location.pathname === '/development/emails' ? (
    <DevelopmentEmailInboxPage />
  ) : (
    <App />
  );

createRoot(root).render(
  <AppErrorBoundary entryLocation={entryLocation}>{content}</AppErrorBoundary>,
);
