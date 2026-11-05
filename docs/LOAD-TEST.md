# Load test

Script: `scripts/load-test.ts`. Targets (B11): 1 000 guests on one night,
50 requests per minute per session, price answers p95 < 150 ms.

## How it was run (2026-11-05)

- Production build (`pnpm build && pnpm start`), one Node process, plus the
  worker, on a 4-core cloud container that also runs Postgres 16 (all
  migrations + seed) and the load generator itself. Supabase Auth and the
  Realtime broadcast endpoint were a local stand-in (the container cannot
  start the Supabase stack), so sign-in timings are not meaningful and
  realtime fan-out is simulated by the script.
- All guests share one client IP, like a club on one Wi-Fi.
- `--fund` credits each test wallet so bids run the price + wallet path;
  MB WAY top-ups could not be measured (Turnstile needs Cloudflare, blocked
  from the container).

```
pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/load-test.ts \
  --guests 1000 --minutes 2 --bids 50 --fund [--no-hints] [--poll-ms 3000]
```

## Results

**Before the changes in this phase** (flat 3 s poll, uncached public state):

| Endpoint | Requests | req/s | p50 ms | p95 ms | Statuses |
| --- | ---: | ---: | ---: | ---: | --- |
| GET auction state | 17 421 | 140 | 6 175 | 6 925 | 200 |
| POST bid | 9 | 0.1 | 9 349 | 12 039 | 200 |
| GET session state | 7 680 | 62 | 14 | 4 835 | **69% refused (429)** |

One process topped out near 140 req/s and the per-IP limit refused most of
the session polls of a full room.

**After, polling only (realtime hints off), one process:**

| Endpoint | Requests | req/s | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| GET party page (arrival, 50 at once) | 1 000 | | 912 | 1 172 | 1 231 |
| GET auction state | 11 234 | 115 | 15 | 59 | 96 |
| POST bid | 69 | 0.7 | 28 | 156 | 240 |
| GET session state | 5 456 | 56 | 9 | 31 | 49 |
| GET search | 683 | 7 | 16 | 58 | 100 |

1 000 guests are served by one process with p95 under 150 ms on every read;
bids p95 156 ms (writes take a row lock on the auction).

**With the board pushed on realtime (the shipped design), 1 000 guests,
50 bids/min, one process:**

| Endpoint | Requests | req/s | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| GET party page (arrival, 50 at once) | 1 000 | | 1 018 | 1 489 | 1 769 |
| GET auction state | 15 000 | 117 | 17 | 58 | 90 |
| POST bid (incl. building the board) | 101 | 0.8 | 44 | 193 | 285 |
| GET session state | 7 457 | 58 | 9 | 28 | 46 |
| GET search | 929 | 7 | 18 | 58 | 101 |

Every read stays under 150 ms at p95. A bid is a write that locks the
auction row and then builds the board for the realtime message, p95 193 ms.
(23 bids hit `above_maximum`: the script raises by the minimum on every bid,
so 100 bids in one auction compound past the cap. Not a server fault.)

**Fallback, board channel down (`--hints refetch`): saturates.** Every bid
makes 1 000 phones read `/api/guest/auction/board` within half a second
(~650 extra requests per second at 50 bids/min). One Node process serves
~300 req/s here, mostly framework overhead per request (CPU profile: no
single hot spot). That route is cacheable for 1 s by a CDN, which is what
keeps this path safe in production if realtime degrades.

## What this means for launch

- 1 000 guests with live bidding fit one app instance when realtime is up.
  Run two anyway for redundancy; the in-process caches are per instance and
  at most 500 ms behind each other.
- Put a CDN in front (`/api/guest/auction/board` sends `s-maxage=1`) so the
  realtime-down fallback cannot overload the origin.
- Arrival: the party page costs ~25 ms of CPU per render, so one process
  admits ~40 new guests per second (1 000 guests in ~20 s).
- Not measured here: real Supabase Auth latency (each guest API call checks
  the token with `auth.getUser()`, one network round trip to Supabase;
  verifying the JWT locally with the project's signing keys would remove
  it), real Realtime fan-out, MB WAY.
