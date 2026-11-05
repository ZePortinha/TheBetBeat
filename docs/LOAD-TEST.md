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

**After, with a realtime hint after every bid (50 bids/min), one process,
no CDN:** still saturated (p50 ~3 s). Every bid makes 1 000 phones read the
board within half a second, about 650 extra requests per second at that bid
rate. One Node process serves ~300 req/s here, mostly framework overhead per
request (CPU profile: no single hot spot), so the database is not the limit.

## What this means for launch

- Polling load for 1 000 guests fits one instance.
- The hint fan-out does not, unless one of these is in place:
  1. a CDN in front of the app: `/api/guest/auction/board` answers with
     `s-maxage=1`, so the origin sees about one board read per second per
     edge location instead of one per phone; or
  2. the board travels inside the realtime message (server-only broadcast
     on an RLS-guarded channel), so phones never refetch on a hint. This is
     the recommended next step: it removes the fan-out regardless of host.
- Arrival: the party page costs ~25 ms of CPU per render, so one process
  admits ~40 new guests per second (1 000 guests in ~21 s).
- Not measured here: real Supabase Auth latency (each guest API call checks
  the token with `auth.getUser()`, one network round trip to Supabase;
  verifying the JWT locally with the project's signing keys would remove
  it), real Realtime fan-out, MB WAY.
