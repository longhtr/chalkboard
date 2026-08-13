-- Pending registration, email-change, and password-reset codes. No user account
-- is created and no email identity changes until its short-lived code is verified.
CREATE TABLE pending_registrations (
  email_normalized TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_registrations_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE INDEX pending_registrations_expiry_idx
  ON pending_registrations(expires_at);

CREATE TABLE pending_email_changes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_email_changes_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE INDEX pending_email_changes_expiry_idx
  ON pending_email_changes(expires_at);

CREATE TABLE pending_password_resets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_password_resets_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE INDEX pending_password_resets_expiry_idx
  ON pending_password_resets(expires_at);
