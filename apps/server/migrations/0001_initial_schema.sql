-- Initial account, session, board, membership, and durable Yjs collaboration schema.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT users_display_name_not_blank CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled board',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT boards_title_not_blank CHECK (length(trim(title)) > 0)
);

CREATE INDEX boards_owner_id_idx ON boards(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX boards_updated_at_idx ON boards(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id),
  CONSTRAINT board_members_role_valid CHECK (role IN ('owner', 'editor', 'viewer'))
);

CREATE INDEX board_members_user_id_idx ON board_members(user_id);

CREATE TABLE yjs_documents (
  board_id UUID PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  snapshot BYTEA NOT NULL,
  snapshot_sequence BIGINT NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT yjs_documents_sequence_nonnegative CHECK (snapshot_sequence >= 0),
  CONSTRAINT yjs_documents_schema_version_positive CHECK (schema_version > 0)
);

CREATE TABLE yjs_updates (
  sequence BIGSERIAL PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX yjs_updates_board_sequence_idx ON yjs_updates(board_id, sequence);
