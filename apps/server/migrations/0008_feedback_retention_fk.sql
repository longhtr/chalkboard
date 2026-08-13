-- Retaining an application suppression must not retain its source feedback event forever.
ALTER TABLE email_suppressions
  DROP CONSTRAINT email_suppressions_source_event_digest_fkey,
  ADD CONSTRAINT email_suppressions_source_event_digest_fkey
    FOREIGN KEY (source_event_digest)
    REFERENCES email_feedback_events(event_digest)
    ON DELETE SET NULL;
