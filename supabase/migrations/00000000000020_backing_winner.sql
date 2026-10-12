-- 2026-10-11 — Backing with a message, and the song goes to whoever spent
-- the most on it (owner's brief). Numbered 20 so it never collides with
-- the other two threads of the same brief (catalog/console, @ handles).
--
-- 1. Backing someone's bid may carry a short message (10 characters) that
--    reaches the guest who made that bid.
-- 2. A bid belongs to the guest with the most money in it: when a backer
--    puts in more than the bidder, the song (if it wins) is theirs: their
--    name on the screens, their celebration, their mic shoutout. The
--    bidder keeps it on a tie.

-- How each guest chose to appear, per action (the bid shows its leader's).
alter table public.auction_contributions
  add column display_mode text check (display_mode in ('anonymous', 'handle', 'table')),
  add column display_label text check (char_length(display_label) <= 40),
  add column message text check (char_length(message) between 1 and 10);

alter table public.auction_intents
  add column message text check (char_length(message) between 1 and 10);

-- Who the bid belongs to now (top spender); the owner stays the guest
-- who picked the track (they raise it, it keeps their track).
alter table public.auction_bids add column leader_guest_id uuid references public.guests (id);
update public.auction_bids set leader_guest_id = owner_guest_id where leader_guest_id is null;

-- The winner of a closed auction (the winning bid's leader at the close).
alter table public.auction_slots add column winner_guest_id uuid references public.guests (id);
update public.auction_slots s set winner_guest_id = b.owner_guest_id
  from public.auction_bids b
 where b.id = s.winning_bid_id and s.winner_guest_id is null;

create index auction_slots_winner_idx on public.auction_slots (winner_guest_id) where winner_guest_id is not null;
create index auction_contributions_message_idx on public.auction_contributions (bid_id) where message is not null;
