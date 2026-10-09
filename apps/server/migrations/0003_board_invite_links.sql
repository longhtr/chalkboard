-- Hashed, expiring, revocable board invitations; bearer-token plaintext is never stored.
CREATE TABLE board_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX board_invite_links_one_active_role_idx
  ON board_invite_links (board_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX board_invite_links_active_board_idx
  ON board_invite_links (board_id, expires_at)
  WHERE revoked_at IS NULL;
