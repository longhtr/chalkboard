/** Public privacy, terms, acceptable-use, retention, deletion, and contact surfaces. */
import type { MouseEvent } from 'react';

import { useModalFocus } from '../components/useModalFocus';
import {
  publicInformationNavigation,
  type PublicInformationPath,
} from './publicRoutes';

interface PublicPage {
  heading: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
}

const pages: Record<string, PublicPage> = {
  '/privacy': {
    heading: 'Privacy',
    sections: [
      {
        heading: 'What Chalkboard stores',
        paragraphs: [
          'Local boards stay in storage managed by your browser. Cloud features store your display name, email address, a one-way password hash, secure session records, board membership, board content, uploaded images, and collaboration state in PostgreSQL.',
          'Verification and recovery codes are stored only as one-way hashes and expire after 15 minutes. The application does not store plaintext passwords or plaintext verification codes.',
        ],
      },
      {
        heading: 'How data is used',
        paragraphs: [
          'Account data is used to authenticate you and provide cloud boards, sharing, collaboration, account recovery, and security controls. Chalkboard does not sell personal information or use board content for advertising.',
          'The service records bounded operational and security logs, including request metadata and network addresses, to keep the service reliable and investigate abuse. It does not intentionally log passwords, session cookies, verification codes, invitation tokens, email addresses, or board content.',
        ],
      },
      {
        heading: 'Sharing and service providers',
        paragraphs: [
          'People you invite to a cloud board can see its content and the display names and email addresses of its members. Do not put information on a shared board unless every board member may access it.',
          'Chalkboard runs on Amazon Web Services. Amazon SES processes destination addresses, message bodies, and delivery events for automated account-security email when those features are enabled. Cloudflare Turnstile processes browser and network signals to distinguish people from automated abuse. Zoho Mail processes addresses, message content, attachments, headers, and delivery or security metadata only when someone emails support@chalkboard.space or Chalkboard replies. Zoho is not used for automated account messages. These providers process data only to operate and protect the service.',
        ],
      },
      {
        heading: 'Retention and deletion',
        paragraphs: [
          'Expired sessions and pending account actions are deleted by bounded maintenance. Digested email-admission records expire after their limiting window; minimum send-intent and feedback metadata is retained for up to 30 days. Boards left in trash for 30 days are permanently deleted. Public demo content and sessions are deleted daily at 00:00 UTC.',
          'You can permanently delete a normal account from Account settings after confirming your current password. This deletes the account, its owned cloud boards, memberships, and uploaded assets from the live database. Logical backups are retained for up to 14 days, and encrypted infrastructure snapshots expire under the service recovery schedule.',
          'Human support correspondence is kept only while reasonably needed to respond, investigate a problem, protect the service, or meet legal obligations, then deleted from the active mailbox. Provider-managed backup, security, or legal-retention copies may remain for longer under Zoho’s policies.',
        ],
      },
      {
        heading: 'Your browser and choices',
        paragraphs: [
          'Chalkboard uses a secure, HTTP-only cookie to maintain a signed-in session. It does not use advertising cookies. You can sign out, delete local boards in the application, clear site storage in your browser, or delete your cloud account in Account settings.',
        ],
      },
    ],
  },
  '/terms': {
    heading: 'Terms of use',
    sections: [
      {
        heading: 'Using Chalkboard',
        paragraphs: [
          'You may use Chalkboard for lawful mathematics, teaching, learning, and collaborative work. You are responsible for activity performed through your account and for content you create, upload, or share.',
          'Do not rely on a public demo account for storage. Demo credentials are shared publicly, other visitors may see or change demo content, and all demo content and sessions are deleted daily at 00:00 UTC.',
        ],
      },
      {
        heading: 'Accounts and content',
        paragraphs: [
          'Provide an email address you control, keep your credentials secure, and do not upload content you lack the right to use. Inviting another person gives that person the selected access to the board.',
          'You retain responsibility for your content. You grant Chalkboard the limited permission needed to store, copy, transmit, back up, and display that content solely to operate and recover the service.',
        ],
      },
      {
        heading: 'Service limits and availability',
        paragraphs: [
          'Account, board, asset, collaboration, and total-storage limits protect this small service and may reject new writes. Features may be changed, paused, or withdrawn to address abuse, security, reliability, legal, or cost concerns.',
          'Chalkboard is provided without a service-level agreement. Keep independent copies of important work. To the extent permitted by law, the service is provided as is and without warranties of uninterrupted availability or fitness for a particular purpose.',
        ],
      },
      {
        heading: 'Enforcement and ending use',
        paragraphs: [
          'Access may be limited or disabled when reasonably necessary to prevent abuse, protect other users, preserve the service, or comply with law. You may stop using the service at any time and may delete a normal account from Account settings.',
        ],
      },
    ],
  },
  '/acceptable-use': {
    heading: 'Acceptable use',
    sections: [
      {
        heading: 'Keep the service safe',
        paragraphs: [
          'Do not use Chalkboard to break the law; harm, threaten, harass, impersonate, or exploit anyone; infringe intellectual-property or privacy rights; distribute malware; or publish secrets or unlawfully obtained personal information.',
          'Do not probe or bypass authentication, authorization, rate limits, storage limits, CAPTCHA, monitoring, or other safeguards. Do not automate account creation, exhaust shared resources, interfere with collaboration, scrape accounts, or use the service to send unsolicited messages.',
        ],
      },
      {
        heading: 'Shared and demo boards',
        paragraphs: [
          'Only invite people who should receive access. Do not use public demo identities for personal, confidential, illegal, or harmful content. Demo activity is intentionally bounded and deleted daily.',
          'Demo and regular accounts are kept apart. An invitation to a regular board cannot be opened by a demo account, and an invitation to a demo board cannot be opened by a regular account. Because demo credentials are published, this keeps a leaked link from exposing private boards.',
        ],
      },
      {
        heading: 'Reporting problems',
        paragraphs: [
          'Report a security, abuse, or availability problem through the contact page. Do not include passwords, session values, private board content, or other sensitive information in a public report.',
        ],
      },
    ],
  },
  '/retention': {
    heading: 'Data retention',
    sections: [
      {
        heading: 'Account-security records',
        paragraphs: [
          'Pending registration, email-change, and password-reset records expire after 15 minutes and are removed by bounded maintenance. Expired sessions are also removed. Verification and reset codes are stored only as one-way hashes and are never retained as plaintext.',
          'Pseudonymous email-admission counters expire after their longest limiting window. Minimum provider send-intent and delivery-feedback metadata is retained for up to 30 days. Application suppression state for a hard bounce or complaint is retained while needed to prevent further unwanted delivery.',
        ],
      },
      {
        heading: 'Boards, accounts, and demos',
        paragraphs: [
          'A board placed in trash remains recoverable for 30 days before permanent deletion. Deleting a normal account immediately removes that account and its owned cloud content from the live database. Local boards remain in browser storage until removed in the application or cleared through the browser.',
          'The five public demo identities are retained, but their boards, assets, collaboration state, and sessions are deleted automatically each day at 00:00 UTC.',
        ],
      },
      {
        heading: 'Recovery copies',
        paragraphs: [
          'Logical database backups are retained for up to 14 days. Encrypted infrastructure snapshots expire under the service recovery schedule. Deletion from the live database therefore does not instantly remove data from an already-created recovery copy; recovery copies are access-restricted and expire through those schedules.',
        ],
      },
    ],
  },
  '/account-deletion': {
    heading: 'Account deletion',
    sections: [
      {
        heading: 'Delete a normal account',
        paragraphs: [
          'Sign in, open Account settings, choose permanent account deletion, and confirm the current password. The current-password check protects against deletion by someone who only obtained an unlocked browser session.',
          'Successful deletion revokes the account sessions and removes the account, its owned cloud boards, board memberships, uploaded assets, invitation relationships, and collaboration state from the live database. Boards owned by someone else are not deleted merely because the departing account was a member.',
        ],
      },
      {
        heading: 'What deletion does not change',
        paragraphs: [
          'Local boards belong to browser storage and are not deleted with a cloud account. Remove them separately from the local-board library or clear the site storage in the browser.',
          'Recovery copies expire according to the retention page rather than being rewritten in place. Public demo identities cannot be deleted through Account settings because they are shared service fixtures whose content and sessions reset daily.',
        ],
      },
    ],
  },
  '/contact': {
    heading: 'Contact',
    sections: [
      {
        heading: 'Support, privacy, and abuse',
        paragraphs: [
          'Email support@chalkboard.space for human help with Chalkboard, a privacy question, or a security or abuse report. This monitored mailbox is provided through Zoho Mail. Do not send a password, session value, verification code, private key, or other authentication secret. Send private board content only when it is necessary to resolve your request and you are authorized to share it.',
          'Use the Chalkboard GitHub issue tracker for non-sensitive bug reports and feature requests. The tracker is public: do not post an email address, private board link, board content, account details, or other personal or confidential information.',
        ],
      },
    ],
  },
};

function canonicalPath(pathname: string): string {
  if (pathname === '/privacy-policy') return '/privacy';
  if (pathname === '/terms-of-use') return '/terms';
  return pathname;
}

function InformationSections({
  dialog,
  page,
}: {
  dialog: boolean;
  page: PublicPage;
}) {
  return (
    <>
      {page.sections.map((section) => (
        <section key={section.heading}>
          {dialog ? <h3>{section.heading}</h3> : <h2>{section.heading}</h2>}
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </>
  );
}

function ContactAction({ canonical }: { canonical: string }) {
  return canonical === '/contact' ? (
    <p className="public-information__contact-action">
      <a href="mailto:support@chalkboard.space">Email Chalkboard support</a>
      <a href="https://github.com/longhtr/chalkboard/issues">
        Open the public issue tracker
      </a>
    </p>
  ) : null;
}

/** Renders a standalone, linkable policy or contact page. */
export function PublicInformationPage({ pathname }: { pathname: string }) {
  const canonical = canonicalPath(pathname);
  const page = pages[canonical];
  if (page === undefined) return null;
  return (
    <main className="public-information public-information--page">
      <div className="public-information__page-shell">
        <header className="public-information__page-header">
          <a className="public-information__home" href="/">
            <span aria-hidden="true">←</span> Back to Chalkboard
          </a>
          <span className="public-information__kicker">Public information</span>
        </header>
        <article className="public-information__article">
          <h1>{page.heading}</h1>
          <InformationSections dialog={false} page={page} />
          <ContactAction canonical={canonical} />
        </article>
        <PublicInformationNavigation canonical={canonical} />
      </div>
    </main>
  );
}

function PublicInformationNavigation({
  canonical,
  onNavigate,
}: {
  canonical: string;
  onNavigate?: (path: PublicInformationPath) => void;
}) {
  function navigate(
    event: MouseEvent<HTMLAnchorElement>,
    path: PublicInformationPath,
  ) {
    if (onNavigate === undefined) return;
    event.preventDefault();
    onNavigate(path);
  }

  return (
    <nav
      className="public-information__navigation"
      aria-label="Public information"
    >
      {publicInformationNavigation.map(([href, label]) => (
        <a
          aria-current={canonical === href ? 'page' : undefined}
          href={href}
          key={href}
          onClick={(event) => navigate(event, href)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

/** Opens public information inside the workspace without replacing the board. */
export function PublicInformationDialog({
  onClose,
  pathname,
}: {
  onClose(): void;
  pathname: PublicInformationPath;
}) {
  const dialogRef = useModalFocus<HTMLElement>();
  const canonical = canonicalPath(pathname);
  const page = pages[canonical];
  if (page === undefined) return null;
  const titleId = 'public-information-dialog-title';

  return (
    <div
      className="public-information-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="public-information public-information-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="public-information-dialog__header">
          <div>
            <span className="public-information__kicker">Chalkboard</span>
            <h2 id={titleId}>{page.heading}</h2>
          </div>
          <button
            className="public-information-dialog__close"
            type="button"
            aria-label="Close public information"
            data-dialog-autofocus
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <article className="public-information-dialog__body">
          <InformationSections dialog page={page} />
          <ContactAction canonical={canonical} />
        </article>
      </section>
    </div>
  );
}
