-- Raise the global normal-board ceiling so it no longer contradicts the account
-- ceiling. At 20 boards per account the previous global cap of 500 was reached
-- by 25 full accounts, an order of magnitude below the 250 account ceiling.
-- 5,000 keeps the two consistent; durable content stays bounded by the
-- unchanged per-board and global byte quotas, which are what protect the disk.
CREATE OR REPLACE FUNCTION admit_board_partition_and_quota()
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
  IF NOT owner_is_demo AND global_normal_board_count >= 5000 THEN
    RAISE EXCEPTION 'global_board_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Raise the per-asset ceiling to match the application admission limit. The
-- database enforced 2.5 MB independently of MAX_ASSET_BYTES, so an application
-- limit above it produced a constraint violation and a 500 rather than a
-- bounded refusal. 10 MB admits an ordinary phone photograph; total stored
-- bytes stay bounded by the unchanged per-account and global content quotas.
ALTER TABLE board_assets DROP CONSTRAINT board_assets_size_valid;
ALTER TABLE board_assets ADD CONSTRAINT board_assets_size_valid CHECK (
  byte_size > 0 AND byte_size <= 10000000 AND octet_length(content) = byte_size
);

-- Lower the global content ceiling to what the disk can actually back up.
-- Board content lives in PostgreSQL, so every byte lands in each daily dump.
-- With 14-day retention the volume must hold the data plus roughly ten times
-- it in dumps; 2 GB needed about 22 GB against ~14 GB usable. 1.2 GB fits with
-- margin and is still far above any current usage. Both quota paths carry the
-- same ceiling and are replaced together so they cannot disagree.
CREATE OR REPLACE FUNCTION admit_asset_quota()
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
  IF NOT uploader_is_demo AND current_normal_bytes + NEW.byte_size > 1200000000 THEN
    RAISE EXCEPTION 'global_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION admit_yjs_bytes(
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
  IF NOT partition_is_demo AND current_normal_bytes + additional_bytes > 1200000000 THEN
    RAISE EXCEPTION 'global_content_quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
