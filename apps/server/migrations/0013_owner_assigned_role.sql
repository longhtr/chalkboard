-- An invite link raises whoever redeems it to the link's role, which was fine
-- while links were the only way in. Once an owner has set somebody's role
-- deliberately, that link becomes a way for the member to overturn the
-- decision: an editor demoted to viewer could redeem a read-and-edit link and
-- promote themselves straight back.
--
-- This records that the role was the owner's choice rather than a link's.
-- Redemption still admits a new member and still grants access, but it leaves
-- an owner-assigned role exactly where the owner put it.
--
-- Existing rows default to false, so a membership created by a link before
-- this migration keeps behaving as a link membership until an owner decides
-- otherwise. That is the honest reading: nobody had made a decision about it.
ALTER TABLE board_members
  ADD COLUMN role_assigned_by_owner BOOLEAN NOT NULL DEFAULT FALSE;
