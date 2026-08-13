/** Development-only browser inbox for exercising complete email-code flows locally. */
import { useCallback, useEffect, useState } from 'react';

import { requestApi } from './api';

interface DevelopmentEmail {
  createdAt: string;
  id: string;
  purpose: string;
  subject: string;
  text: string;
  to: string;
}

function decodeInbox(value: unknown): { emails: DevelopmentEmail[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('emails' in value) ||
    !Array.isArray(value.emails)
  ) {
    throw new Error('Invalid development inbox');
  }
  return {
    emails: value.emails.map((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('createdAt' in item) ||
        typeof item.createdAt !== 'string' ||
        !('id' in item) ||
        typeof item.id !== 'string' ||
        !('purpose' in item) ||
        typeof item.purpose !== 'string' ||
        !('subject' in item) ||
        typeof item.subject !== 'string' ||
        !('text' in item) ||
        typeof item.text !== 'string' ||
        !('to' in item) ||
        typeof item.to !== 'string'
      ) {
        throw new Error('Invalid development email');
      }
      return {
        createdAt: item.createdAt,
        id: item.id,
        purpose: item.purpose,
        subject: item.subject,
        text: item.text,
        to: item.to,
      };
    }),
  };
}

export function DevelopmentEmailInboxPage() {
  const [emails, setEmails] = useState<DevelopmentEmail[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await requestApi(
        '/api/development/emails',
        undefined,
        decodeInbox,
      );
      setEmails(response.emails);
      setError('');
    } catch {
      setError(
        'The local email inbox is unavailable. Is the dev server running?',
      );
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <main className="development-inbox">
      <header>
        <div>
          <p className="account-kicker">Development only</p>
          <h1>Local email inbox</h1>
          <p>
            No network email is sent. Messages are accepted only for addresses
            ending in <code>@chalkboard.test</code> and disappear when the API
            restarts.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>
      {error === '' ? null : <p role="alert">{error}</p>}
      {emails.length === 0 ? (
        <p className="development-inbox__empty">No captured messages yet.</p>
      ) : (
        <ol>
          {emails.map((email) => (
            <li key={email.id}>
              <dl>
                <div>
                  <dt>To</dt>
                  <dd>{email.to}</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>{email.purpose}</dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{new Date(email.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
              <h2>{email.subject}</h2>
              <pre>{email.text}</pre>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
