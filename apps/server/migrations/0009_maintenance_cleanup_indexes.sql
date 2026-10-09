-- Match every global retention scan with an index and bound provider metadata
-- before the account-email path can write it.
CREATE INDEX boards_deleted_at_cleanup_idx
  ON boards(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX board_invite_links_expires_cleanup_idx
  ON board_invite_links(expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX board_invite_links_revoked_cleanup_idx
  ON board_invite_links(revoked_at)
  WHERE revoked_at IS NOT NULL;

ALTER TABLE email_send_intents
  ADD CONSTRAINT email_send_intents_provider_message_id_bounded CHECK (
    provider_message_id IS NULL OR
    length(provider_message_id) BETWEEN 1 AND 512
  );
