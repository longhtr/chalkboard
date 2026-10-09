-- Explicit demo partition, transactional storage ledgers, and daily-reset state.
ALTER TABLE users
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_demo = TRUE
WHERE email_normalized IN (
  'demo1@chalkboard.invalid',
  'demo2@chalkboard.invalid',
  'demo3@chalkboard.invalid',
  'demo4@chalkboard.invalid',
  'demo5@chalkboard.invalid'
);

ALTER TABLE boards
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE boards
SET is_demo = users.is_demo
FROM users
WHERE users.id = boards.owner_id;

ALTER TABLE board_assets
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE yjs_documents
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE yjs_updates
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE board_assets
SET is_demo = boards.is_demo
FROM boards
WHERE boards.id = board_assets.board_id;
UPDATE yjs_documents
SET is_demo = boards.is_demo
FROM boards
WHERE boards.id = yjs_documents.board_id;
UPDATE yjs_updates
SET is_demo = boards.is_demo
FROM boards
WHERE boards.id = yjs_updates.board_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM board_members
    JOIN boards ON boards.id = board_members.board_id
    JOIN users ON users.id = board_members.user_id
    WHERE boards.is_demo IS DISTINCT FROM users.is_demo
  ) THEN
    RAISE EXCEPTION 'existing_board_membership_partition_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM board_assets
    JOIN boards ON boards.id = board_assets.board_id
    JOIN users ON users.id = board_assets.uploaded_by
    WHERE boards.is_demo IS DISTINCT FROM users.is_demo
  ) THEN
    RAISE EXCEPTION 'existing_asset_partition_mismatch';
  END IF;
END;
$$;

CREATE INDEX boards_owner_id_all_idx ON boards(owner_id);
CREATE INDEX boards_demo_idx ON boards(id) WHERE is_demo;
CREATE INDEX users_demo_idx ON users(id) WHERE is_demo;
CREATE INDEX board_assets_uploaded_by_idx ON board_assets(uploaded_by);

CREATE TABLE user_storage_usage (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  board_count INTEGER NOT NULL DEFAULT 0,
  asset_count INTEGER NOT NULL DEFAULT 0,
  asset_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT user_storage_usage_nonnegative CHECK (
    board_count >= 0 AND asset_count >= 0 AND asset_bytes >= 0
  )
);

INSERT INTO user_storage_usage (user_id, board_count, asset_count, asset_bytes)
SELECT users.id,
  (SELECT COUNT(*)::INTEGER FROM boards WHERE boards.owner_id = users.id),
  (SELECT COUNT(*)::INTEGER FROM board_assets WHERE board_assets.uploaded_by = users.id),
  (SELECT COALESCE(SUM(board_assets.byte_size), 0)::BIGINT
     FROM board_assets WHERE board_assets.uploaded_by = users.id)
FROM users;

CREATE TABLE board_storage_usage (
  board_id UUID PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  yjs_snapshot_bytes BIGINT NOT NULL DEFAULT 0,
  yjs_update_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT board_storage_usage_nonnegative CHECK (
    yjs_snapshot_bytes >= 0 AND yjs_update_bytes >= 0
  )
);

INSERT INTO board_storage_usage (
  board_id, yjs_snapshot_bytes, yjs_update_bytes
)
SELECT boards.id,
  COALESCE((
    SELECT octet_length(yjs_documents.snapshot)::BIGINT
    FROM yjs_documents WHERE yjs_documents.board_id = boards.id
  ), 0),
  COALESCE((
    SELECT SUM(octet_length(yjs_updates.update))::BIGINT
    FROM yjs_updates WHERE yjs_updates.board_id = boards.id
  ), 0)
FROM boards;

CREATE TABLE application_storage_usage (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
  normal_board_count INTEGER NOT NULL DEFAULT 0,
  demo_board_count INTEGER NOT NULL DEFAULT 0,
  normal_content_bytes BIGINT NOT NULL DEFAULT 0,
  demo_content_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT application_storage_usage_singleton CHECK (singleton),
  CONSTRAINT application_storage_usage_nonnegative CHECK (
    normal_board_count >= 0 AND demo_board_count >= 0
      AND normal_content_bytes >= 0 AND demo_content_bytes >= 0
  )
);

INSERT INTO application_storage_usage (
  singleton, normal_board_count, demo_board_count,
  normal_content_bytes, demo_content_bytes
)
WITH content_usage AS (
  SELECT boards.is_demo, board_assets.byte_size::BIGINT AS byte_size
  FROM board_assets
  JOIN boards ON boards.id = board_assets.board_id
  UNION ALL
  SELECT boards.is_demo, octet_length(yjs_documents.snapshot)::BIGINT
  FROM yjs_documents
  JOIN boards ON boards.id = yjs_documents.board_id
  UNION ALL
  SELECT boards.is_demo, octet_length(yjs_updates.update)::BIGINT
  FROM yjs_updates
  JOIN boards ON boards.id = yjs_updates.board_id
)
SELECT TRUE,
  (SELECT COUNT(*)::INTEGER FROM boards WHERE NOT is_demo),
  (SELECT COUNT(*)::INTEGER FROM boards WHERE is_demo),
  COALESCE(SUM(byte_size) FILTER (WHERE NOT is_demo), 0)::BIGINT,
  COALESCE(SUM(byte_size) FILTER (WHERE is_demo), 0)::BIGINT
FROM content_usage;

CREATE TABLE application_maintenance_state (
  name TEXT PRIMARY KEY,
  last_succeeded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT application_maintenance_state_name_not_blank CHECK (
    length(trim(name)) > 0
  )
);

INSERT INTO application_maintenance_state (name, last_succeeded_at)
VALUES ('demo-daily-reset', NOW());

CREATE FUNCTION initialize_user_storage_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_storage_usage (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_initialize_storage_usage
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION initialize_user_storage_usage();

CREATE FUNCTION protect_demo_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_demo IS DISTINCT FROM NEW.is_demo THEN
    RAISE EXCEPTION 'account_partition_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_protect_demo_classification
BEFORE UPDATE OF is_demo ON users
FOR EACH ROW
EXECUTE FUNCTION protect_demo_classification();

CREATE FUNCTION enforce_normal_account_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  normal_account_count INTEGER;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chalkboard:normal-account-ceiling', 0)
  );
  SELECT count(*) INTO normal_account_count
  FROM users
  WHERE NOT is_demo;
  IF normal_account_count >= 250 THEN
    RAISE EXCEPTION 'account_ceiling_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_enforce_normal_account_ceiling
BEFORE INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_normal_account_ceiling();

CREATE FUNCTION admit_board_partition_and_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_is_demo BOOLEAN;
  owner_board_count INTEGER;
  global_normal_board_count INTEGER;
BEGIN
  SELECT users.is_demo
  INTO owner_is_demo
  FROM users
  WHERE users.id = NEW.owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'board_owner_not_found' USING ERRCODE = 'P0001';
  END IF;

  NEW.is_demo := owner_is_demo;

  SELECT board_count
  INTO owner_board_count
  FROM user_storage_usage
  WHERE user_id = NEW.owner_id
  FOR UPDATE;

  SELECT normal_board_count
  INTO global_normal_board_count
  FROM application_storage_usage
  WHERE singleton
  FOR UPDATE;

  IF owner_is_demo AND owner_board_count >= 3 THEN
    RAISE EXCEPTION 'demo_board_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT owner_is_demo AND owner_board_count >= 20 THEN
    RAISE EXCEPTION 'account_board_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT owner_is_demo AND global_normal_board_count >= 500 THEN
    RAISE EXCEPTION 'global_board_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER boards_admit_partition_and_quota
BEFORE INSERT ON boards
FOR EACH ROW
EXECUTE FUNCTION admit_board_partition_and_quota();

CREATE FUNCTION protect_board_partition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.owner_id IS DISTINCT FROM NEW.owner_id
    OR OLD.is_demo IS DISTINCT FROM NEW.is_demo THEN
    RAISE EXCEPTION 'board_partition_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER boards_protect_partition
BEFORE UPDATE OF owner_id, is_demo ON boards
FOR EACH ROW
EXECUTE FUNCTION protect_board_partition();

CREATE FUNCTION record_board_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO board_storage_usage (board_id) VALUES (NEW.id);
  UPDATE user_storage_usage
  SET board_count = board_count + 1
  WHERE user_id = NEW.owner_id;
  UPDATE application_storage_usage
  SET normal_board_count = normal_board_count + CASE WHEN NEW.is_demo THEN 0 ELSE 1 END,
      demo_board_count = demo_board_count + CASE WHEN NEW.is_demo THEN 1 ELSE 0 END
  WHERE singleton;
  RETURN NEW;
END;
$$;

CREATE TRIGGER boards_record_insert
AFTER INSERT ON boards
FOR EACH ROW
EXECUTE FUNCTION record_board_insert();

CREATE FUNCTION record_board_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_storage_usage
  SET board_count = board_count - 1
  WHERE user_id = OLD.owner_id;
  UPDATE application_storage_usage
  SET normal_board_count = normal_board_count - CASE WHEN OLD.is_demo THEN 0 ELSE 1 END,
      demo_board_count = demo_board_count - CASE WHEN OLD.is_demo THEN 1 ELSE 0 END
  WHERE singleton;
  RETURN OLD;
END;
$$;

CREATE TRIGGER boards_record_delete
AFTER DELETE ON boards
FOR EACH ROW
EXECUTE FUNCTION record_board_delete();

CREATE FUNCTION enforce_membership_partition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  member_is_demo BOOLEAN;
  board_is_demo BOOLEAN;
BEGIN
  SELECT users.is_demo INTO member_is_demo
  FROM users WHERE users.id = NEW.user_id;
  SELECT boards.is_demo INTO board_is_demo
  FROM boards WHERE boards.id = NEW.board_id;

  IF member_is_demo IS NULL OR board_is_demo IS NULL
    OR member_is_demo IS DISTINCT FROM board_is_demo THEN
    RAISE EXCEPTION 'board_membership_partition_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_members_enforce_partition
BEFORE INSERT OR UPDATE OF board_id, user_id ON board_members
FOR EACH ROW
EXECUTE FUNCTION enforce_membership_partition();

CREATE FUNCTION admit_asset_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  uploader_is_demo BOOLEAN;
  board_is_demo BOOLEAN;
  current_asset_count INTEGER;
  current_asset_bytes BIGINT;
  current_normal_bytes BIGINT;
  current_demo_bytes BIGINT;
BEGIN
  SELECT users.is_demo, usage.asset_count, usage.asset_bytes
  INTO uploader_is_demo, current_asset_count, current_asset_bytes
  FROM users
  JOIN user_storage_usage AS usage ON usage.user_id = users.id
  WHERE users.id = NEW.uploaded_by
  FOR UPDATE OF users, usage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asset_uploader_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT is_demo INTO board_is_demo
  FROM boards WHERE id = NEW.board_id;
  IF board_is_demo IS NULL OR board_is_demo IS DISTINCT FROM uploader_is_demo THEN
    RAISE EXCEPTION 'board_membership_partition_mismatch' USING ERRCODE = 'P0001';
  END IF;
  NEW.is_demo := board_is_demo;

  SELECT normal_content_bytes, demo_content_bytes
  INTO current_normal_bytes, current_demo_bytes
  FROM application_storage_usage
  WHERE singleton
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM board_assets
    WHERE board_id = NEW.board_id AND content_hash = NEW.content_hash
  ) THEN
    RETURN NULL;
  END IF;

  IF uploader_is_demo AND (
    current_asset_count >= 20 OR current_asset_bytes + NEW.byte_size > 10485760
  ) THEN
    RAISE EXCEPTION 'demo_asset_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT uploader_is_demo AND (
    current_asset_count >= 200 OR current_asset_bytes + NEW.byte_size > 52428800
  ) THEN
    RAISE EXCEPTION 'account_asset_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF uploader_is_demo AND current_demo_bytes + NEW.byte_size > 52428800 THEN
    RAISE EXCEPTION 'global_demo_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT uploader_is_demo AND current_normal_bytes + NEW.byte_size > 2147483648 THEN
    RAISE EXCEPTION 'global_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER board_assets_admit_quota
BEFORE INSERT ON board_assets
FOR EACH ROW
EXECUTE FUNCTION admit_asset_quota();

CREATE FUNCTION protect_asset_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.board_id IS DISTINCT FROM NEW.board_id
    OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by
    OR OLD.is_demo IS DISTINCT FROM NEW.is_demo
    OR OLD.byte_size IS DISTINCT FROM NEW.byte_size
    OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
    OR OLD.content IS DISTINCT FROM NEW.content THEN
    RAISE EXCEPTION 'board_asset_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_assets_protect_immutability
BEFORE UPDATE ON board_assets
FOR EACH ROW
EXECUTE FUNCTION protect_asset_immutability();

CREATE FUNCTION record_asset_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_storage_usage
  SET asset_count = asset_count + 1,
      asset_bytes = asset_bytes + NEW.byte_size
  WHERE user_id = NEW.uploaded_by;
  UPDATE application_storage_usage
  SET normal_content_bytes = normal_content_bytes
        + CASE WHEN NEW.is_demo THEN 0 ELSE NEW.byte_size END,
      demo_content_bytes = demo_content_bytes
        + CASE WHEN NEW.is_demo THEN NEW.byte_size ELSE 0 END
  WHERE singleton;
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_assets_record_insert
AFTER INSERT ON board_assets
FOR EACH ROW
EXECUTE FUNCTION record_asset_insert();

CREATE FUNCTION record_asset_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_storage_usage
  SET asset_count = asset_count - 1,
      asset_bytes = asset_bytes - OLD.byte_size
  WHERE user_id = OLD.uploaded_by;
  UPDATE application_storage_usage
  SET normal_content_bytes = normal_content_bytes
        - CASE WHEN OLD.is_demo THEN 0 ELSE OLD.byte_size END,
      demo_content_bytes = demo_content_bytes
        - CASE WHEN OLD.is_demo THEN OLD.byte_size ELSE 0 END
  WHERE singleton;
  RETURN OLD;
END;
$$;

CREATE TRIGGER board_assets_record_delete
AFTER DELETE ON board_assets
FOR EACH ROW
EXECUTE FUNCTION record_asset_delete();

CREATE FUNCTION admit_yjs_bytes(
  target_board_id UUID,
  additional_bytes BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  partition_is_demo BOOLEAN;
  current_board_bytes BIGINT;
  current_normal_bytes BIGINT;
  current_demo_bytes BIGINT;
BEGIN
  SELECT boards.is_demo,
    usage.yjs_snapshot_bytes + usage.yjs_update_bytes
  INTO partition_is_demo, current_board_bytes
  FROM boards
  JOIN board_storage_usage AS usage ON usage.board_id = boards.id
  WHERE boards.id = target_board_id
  FOR UPDATE OF boards, usage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'yjs_board_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT normal_content_bytes, demo_content_bytes
  INTO current_normal_bytes, current_demo_bytes
  FROM application_storage_usage
  WHERE singleton
  FOR UPDATE;

  IF partition_is_demo AND current_board_bytes + additional_bytes > 1048576 THEN
    RAISE EXCEPTION 'demo_yjs_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT partition_is_demo AND current_board_bytes + additional_bytes > 5242880 THEN
    RAISE EXCEPTION 'board_yjs_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF partition_is_demo AND current_demo_bytes + additional_bytes > 52428800 THEN
    RAISE EXCEPTION 'global_demo_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT partition_is_demo AND current_normal_bytes + additional_bytes > 2147483648 THEN
    RAISE EXCEPTION 'global_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE FUNCTION admit_yjs_update_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT is_demo INTO NEW.is_demo FROM boards WHERE id = NEW.board_id;
  IF NEW.is_demo IS NULL THEN
    RAISE EXCEPTION 'yjs_board_not_found' USING ERRCODE = 'P0001';
  END IF;
  PERFORM admit_yjs_bytes(NEW.board_id, octet_length(NEW.update));
  RETURN NEW;
END;
$$;

CREATE TRIGGER yjs_updates_admit_quota
BEFORE INSERT ON yjs_updates
FOR EACH ROW
EXECUTE FUNCTION admit_yjs_update_quota();

CREATE FUNCTION protect_yjs_update_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'yjs_update_is_immutable' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER yjs_updates_protect_immutability
BEFORE UPDATE ON yjs_updates
FOR EACH ROW
EXECUTE FUNCTION protect_yjs_update_immutability();

CREATE FUNCTION record_yjs_update_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  bytes BIGINT := octet_length(NEW.update);
BEGIN
  UPDATE board_storage_usage
  SET yjs_update_bytes = yjs_update_bytes + bytes
  WHERE board_id = NEW.board_id;
  UPDATE application_storage_usage
  SET normal_content_bytes = normal_content_bytes
        + CASE WHEN NEW.is_demo THEN 0 ELSE bytes END,
      demo_content_bytes = demo_content_bytes
        + CASE WHEN NEW.is_demo THEN bytes ELSE 0 END
  WHERE singleton;
  RETURN NEW;
END;
$$;

CREATE TRIGGER yjs_updates_record_insert
AFTER INSERT ON yjs_updates
FOR EACH ROW
EXECUTE FUNCTION record_yjs_update_insert();

CREATE FUNCTION record_yjs_update_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  bytes BIGINT := octet_length(OLD.update);
BEGIN
  UPDATE board_storage_usage
  SET yjs_update_bytes = yjs_update_bytes - bytes
  WHERE board_id = OLD.board_id;
  UPDATE application_storage_usage
  SET normal_content_bytes = normal_content_bytes
        - CASE WHEN OLD.is_demo THEN 0 ELSE bytes END,
      demo_content_bytes = demo_content_bytes
        - CASE WHEN OLD.is_demo THEN bytes ELSE 0 END
  WHERE singleton;
  RETURN OLD;
END;
$$;

CREATE TRIGGER yjs_updates_record_delete
AFTER DELETE ON yjs_updates
FOR EACH ROW
EXECUTE FUNCTION record_yjs_update_delete();

CREATE FUNCTION admit_yjs_document_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_bytes BIGINT := CASE
    WHEN TG_OP = 'UPDATE' THEN octet_length(OLD.snapshot)
    ELSE 0
  END;
  additional_bytes BIGINT := octet_length(NEW.snapshot) - previous_bytes;
BEGIN
  SELECT is_demo INTO NEW.is_demo FROM boards WHERE id = NEW.board_id;
  IF NEW.is_demo IS NULL THEN
    RAISE EXCEPTION 'yjs_board_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF additional_bytes > 0 THEN
    PERFORM admit_yjs_bytes(NEW.board_id, additional_bytes);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER yjs_documents_admit_quota
BEFORE INSERT OR UPDATE OF snapshot ON yjs_documents
FOR EACH ROW
EXECUTE FUNCTION admit_yjs_document_quota();

CREATE FUNCTION protect_yjs_document_partition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.board_id IS DISTINCT FROM NEW.board_id
    OR OLD.is_demo IS DISTINCT FROM NEW.is_demo THEN
    RAISE EXCEPTION 'yjs_document_board_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER yjs_documents_protect_partition
BEFORE UPDATE OF board_id, is_demo ON yjs_documents
FOR EACH ROW
EXECUTE FUNCTION protect_yjs_document_partition();

CREATE FUNCTION record_yjs_document_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_board_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.board_id ELSE NEW.board_id END;
  old_bytes BIGINT := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN octet_length(OLD.snapshot) ELSE 0 END;
  new_bytes BIGINT := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN octet_length(NEW.snapshot) ELSE 0 END;
  delta BIGINT := new_bytes - old_bytes;
  partition_is_demo BOOLEAN := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.is_demo
    ELSE NEW.is_demo
  END;
BEGIN
  UPDATE board_storage_usage
  SET yjs_snapshot_bytes = yjs_snapshot_bytes + delta
  WHERE board_id = target_board_id;
  UPDATE application_storage_usage
  SET normal_content_bytes = normal_content_bytes
        + CASE WHEN partition_is_demo THEN 0 ELSE delta END,
      demo_content_bytes = demo_content_bytes
        + CASE WHEN partition_is_demo THEN delta ELSE 0 END
  WHERE singleton;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER yjs_documents_record_change
AFTER INSERT OR UPDATE OF snapshot OR DELETE ON yjs_documents
FOR EACH ROW
EXECUTE FUNCTION record_yjs_document_change();
