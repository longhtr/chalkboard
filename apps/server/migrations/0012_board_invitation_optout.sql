-- Somebody who does not want to be offered boards at all should not have to
-- decline each offer individually. This is that switch, and it belongs to the
-- invitee: the person being offered something decides whether to be offered.
--
-- Existing accounts keep the behaviour they already had, so the default is to
-- accept offers. Turning it off refuses new offers only. It does not remove
-- boards already joined, because those were consented to separately and taking
-- them away would be a different decision than the one this switch expresses.
ALTER TABLE users
  ADD COLUMN accepts_board_invitations BOOLEAN NOT NULL DEFAULT TRUE;
