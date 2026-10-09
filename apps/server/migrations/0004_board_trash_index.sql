-- Supports owner trash listing and active/trash membership queries without scanning all boards.
CREATE INDEX boards_owner_deleted_at_idx
  ON boards (owner_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
