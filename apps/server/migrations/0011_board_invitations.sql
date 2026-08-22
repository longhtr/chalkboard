-- Sharing a board by email used to write the membership itself, so a board
-- someone else owned appeared among your own the moment they typed your
-- address. Consent now sits between the two: an invitation is offered, and
-- only accepting it writes the membership.
--
-- A row here is a pending offer and nothing else. Accepting deletes it and
-- inserts the membership in one transaction; declining deletes it. Keeping a
-- decided row would make re-inviting somebody who changed their mind a
-- special case, and would keep a record of a decision the invitee made about
-- a board they chose not to join.
CREATE TABLE board_invitations (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id),
  CONSTRAINT board_invitations_role_valid CHECK (role IN ('editor', 'viewer'))
);

-- The invitee's own list is the read this table exists to serve.
CREATE INDEX board_invitations_user_id_idx ON board_invitations(user_id);
