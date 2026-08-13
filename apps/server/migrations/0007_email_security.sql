-- Durable email admission, send intents, provider feedback, suppression, and
-- emergency switches. Raw client addresses and unknown reset destinations are
-- intentionally absent from admission and feedback tables.
CREATE TABLE email_flow_switches (
  flow TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_flow_switches_flow_valid CHECK (
    flow IN ('registration', 'password-reset', 'email-change')
  ),
  CONSTRAINT email_flow_switches_reason_bounded CHECK (
    length(reason) BETWEEN 1 AND 120
  )
);

INSERT INTO email_flow_switches (flow, enabled, reason) VALUES
  ('registration', FALSE, 'awaiting-account-email-canary'),
  ('password-reset', FALSE, 'awaiting-account-email-canary'),
  ('email-change', FALSE, 'awaiting-account-email-canary');

-- The trigger in 0006 remains the transactional authority, but its launch
-- ceiling is data-controlled so the public canary can start below the immutable
-- hard maximum without an application redeploy.
CREATE TABLE account_registration_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
  verified_account_limit INTEGER NOT NULL,
  reason TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_registration_settings_singleton CHECK (singleton),
  CONSTRAINT account_registration_settings_limit CHECK (
    verified_account_limit BETWEEN 1 AND 250
  ),
  CONSTRAINT account_registration_settings_reason_bounded CHECK (
    length(reason) BETWEEN 1 AND 120
  )
);

INSERT INTO account_registration_settings (
  singleton, verified_account_limit, reason
) VALUES (TRUE, 10, 'account-email-canary');

CREATE OR REPLACE FUNCTION enforce_normal_account_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  normal_account_count INTEGER;
  configured_account_limit INTEGER;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chalkboard:normal-account-ceiling', 0)
  );
  SELECT COALESCE(
    NULLIF(current_setting(
      'chalkboard.account_registration_limit', TRUE
    ), '')::INTEGER,
    verified_account_limit
  ) INTO STRICT configured_account_limit
  FROM account_registration_settings
  WHERE singleton;
  IF configured_account_limit NOT BETWEEN 1 AND 250 THEN
    RAISE EXCEPTION 'account_ceiling_configuration_invalid'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO normal_account_count
  FROM users
  WHERE NOT is_demo;
  IF normal_account_count >= configured_account_limit THEN
    RAISE EXCEPTION 'account_ceiling_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE email_admission_events (
  id BIGSERIAL PRIMARY KEY,
  key_generation INTEGER NOT NULL,
  flow TEXT NOT NULL,
  scope TEXT NOT NULL,
  subject_digest TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_admission_events_key_generation_positive CHECK (
    key_generation > 0
  ),
  CONSTRAINT email_admission_events_flow_valid CHECK (
    flow IN ('registration', 'password-reset', 'email-change')
  ),
  CONSTRAINT email_admission_events_scope_valid CHECK (
    scope IN ('ip', 'destination', 'account')
  ),
  CONSTRAINT email_admission_events_digest_valid CHECK (
    subject_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT email_admission_events_expiry_valid CHECK (
    expires_at > occurred_at
  )
);

CREATE INDEX email_admission_events_lookup_idx
  ON email_admission_events(
    key_generation, flow, scope, subject_digest, occurred_at DESC
  );
CREATE INDEX email_admission_events_expiry_idx
  ON email_admission_events(expires_at);

CREATE TABLE email_send_intents (
  id UUID PRIMARY KEY,
  key_generation INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  destination_digest TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  provider_message_id TEXT UNIQUE,
  failure_class TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT email_send_intents_key_generation_positive CHECK (
    key_generation > 0
  ),
  CONSTRAINT email_send_intents_purpose_valid CHECK (
    purpose IN ('registration', 'password-reset', 'email-change')
  ),
  CONSTRAINT email_send_intents_digest_valid CHECK (
    destination_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT email_send_intents_status_valid CHECK (
    status IN ('reserved', 'accepted', 'rejected', 'ambiguous', 'not-needed')
  ),
  CONSTRAINT email_send_intents_failure_class_valid CHECK (
    failure_class IS NULL OR failure_class IN (
      'configuration', 'destination', 'provider-rejection', 'transport',
      'unknown'
    )
  ),
  CONSTRAINT email_send_intents_resolution_valid CHECK (
    (status IN ('reserved', 'ambiguous') AND resolved_at IS NULL)
    OR (status IN ('accepted', 'rejected', 'not-needed') AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX email_send_intents_created_idx
  ON email_send_intents(created_at DESC);
CREATE INDEX email_send_intents_destination_idx
  ON email_send_intents(key_generation, destination_digest, created_at DESC);
CREATE INDEX email_send_intents_unresolved_idx
  ON email_send_intents(created_at)
  WHERE status IN ('reserved', 'ambiguous');

CREATE TABLE email_feedback_events (
  event_digest TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  suppression_reason TEXT,
  send_intent_id UUID REFERENCES email_send_intents(id) ON DELETE SET NULL,
  provider_message_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_feedback_events_digest_valid CHECK (
    event_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT email_feedback_events_type_valid CHECK (
    event_type IN (
      'send', 'reject', 'rendering-failure', 'delivery', 'delivery-delay',
      'bounce', 'complaint'
    )
  ),
  CONSTRAINT email_feedback_events_provider_id_bounded CHECK (
    length(provider_message_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT email_feedback_events_suppression_reason_valid CHECK (
    suppression_reason IS NULL OR
    suppression_reason IN ('hard-bounce', 'complaint')
  )
);

CREATE INDEX email_feedback_events_received_idx
  ON email_feedback_events(received_at);
CREATE INDEX email_feedback_events_intent_idx
  ON email_feedback_events(send_intent_id, received_at DESC);

CREATE TABLE email_suppressions (
  key_generation INTEGER NOT NULL,
  destination_digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_digest TEXT REFERENCES email_feedback_events(event_digest),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key_generation, destination_digest),
  CONSTRAINT email_suppressions_key_generation_positive CHECK (
    key_generation > 0
  ),
  CONSTRAINT email_suppressions_digest_valid CHECK (
    destination_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT email_suppressions_reason_valid CHECK (
    reason IN ('hard-bounce', 'complaint')
  )
);

ALTER TABLE pending_registrations
  ADD COLUMN generation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN send_intent_id UUID REFERENCES email_send_intents(id),
  ADD COLUMN last_sent_at TIMESTAMPTZ;

ALTER TABLE pending_email_changes
  ADD COLUMN generation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN send_intent_id UUID REFERENCES email_send_intents(id),
  ADD COLUMN last_sent_at TIMESTAMPTZ;

ALTER TABLE pending_password_resets
  ADD COLUMN generation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN send_intent_id UUID REFERENCES email_send_intents(id),
  ADD COLUMN last_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX pending_registrations_generation_idx
  ON pending_registrations(generation_id);
CREATE UNIQUE INDEX pending_email_changes_generation_idx
  ON pending_email_changes(generation_id);
CREATE UNIQUE INDEX pending_password_resets_generation_idx
  ON pending_password_resets(generation_id);
