-- Immutable board-scoped image bytes with uploader, dimensions, type, and content hash.
CREATE TABLE board_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  content_hash BYTEA NOT NULL,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT board_assets_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT board_assets_media_type_valid CHECK (
    media_type IN (
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/svg+xml',
      'image/webp'
    )
  ),
  CONSTRAINT board_assets_size_valid CHECK (
    byte_size > 0 AND byte_size <= 2500000 AND octet_length(content) = byte_size
  ),
  CONSTRAINT board_assets_dimensions_valid CHECK (
    width > 0 AND height > 0 AND width <= 16384 AND height <= 16384
      AND width::BIGINT * height::BIGINT <= 64000000
  ),
  UNIQUE (board_id, content_hash)
);

CREATE INDEX board_assets_board_id_idx ON board_assets(board_id);
