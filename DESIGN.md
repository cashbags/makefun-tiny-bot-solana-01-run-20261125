# Design: quiet trend rider with a trade-count floor

## The problem in one paragraph

The dev window falls 8.7% from end to end, and every kit baseline that
trades often loses more than the ones that trade rarely. At the same time
the entry must clear 8 trades on a 72-bar final window it has never seen,
in any market regime. A bot that only ever buys confirmed trends can end
a quiet window with 2 trades and fail the guardrail; a bot that trades
freely bleeds fees and whipsaw losses in a falling market. The design
below resolves that tension with one selective rule for profit and two
pace-based insurance tiers that exist only to bank fills.

## Primary rule: buy strength, not noise

Per symbol, the bot watches a fast EMA(6) against a slow EMA(18). An
entry needs all three at once: the fast average above the slow one, the
close above the slow average, and a 12-bar return of at least +2.5%.
The first two say a trend exists; the third says it is a real move and
not a one-bar wiggle of the averages. Entries fire on a fresh cross-up,
or as a continuation when a symbol exited at least 6 bars ago and its
close has climbed back above that exit's price — so a trend that keeps
running gets re-entered, but a symbol that stopped out is not touched
again until the price proves itself above the exit. Each leg risks
equity / 6, capped at the 25% weight limit, so at most six legs are open
and a single bad leg costs little.

## Exits: let winners run, cut losers at fixed distances

A leg exits whole on the first of: the fast average crossing back below
the slow one; +6% over cost; a close 3% under the highest close since
entry; −4% under cost; or 48 bars of age. The take-profit and the
trailing stop do different jobs — the first banks a fast move, the
second protects a slow grind — and the age exit only recycles a leg that
has gone stale, which also keeps capital turning over in a one-way
market.

## Insurance tiers: the guardrail is a constraint, not a target

The bot counts its own fills from each batch's fill list. From bar 24,
while fewer than 10 fills are banked, entries drop the momentum test
(any bar the trend is on, after the cooldown) at equity / 16 a leg.
From bar 48, while fewer than 8 fills are banked and no buy was decided
this bar, it buys the least-bad symbol — best 12-bar return, even if
negative — one leg a bar at equity / 16. These tiers are deliberately
small and late: on a normal window they never fire, and on a quiet or
one-way down window they are the difference between a valid entry and
one that ranks below every compliant entry. Their expected cost is a
few tens of dollars against a buy-and-hold loss in the hundreds.

## What was measured, and what was not claimed

Local grades on the dev window (grade-local, process driver): the
baselines score buy-and-hold −$869.34 (7 trades), ema-cross −$173.04,
momentum −$268.23, macd-cci −$20.22, rsi-bollinger −$56.49. This entry
scores +$23.23 with 14 trades and 1.18% max drawdown. A 20-copy
block-bootstrap stress (6-bar blocks of each symbol's own returns)
gives a median of −$169 against buy-and-hold's −$899 on the same
copies: the entry loses money in absolute terms on most reshuffled
down-drift windows, but beats buy-and-hold by roughly $700 at the
median, and it clears the guardrail on every copy. The dev +$23 is a
good draw, not a promise — WIF contributes +$43.62 of it — and the
final window is unseen. The honest claim is relative: in a falling
market this bot loses far less than holding, and in a rising market
(tilted-tape test: +$610 on a strong up-tilt, +$107 on a mild 72-bar
up-tilt) it participates with a profit.

## Determinism

No clock, no randomness, no environment reads, no network. All
decisions come from the bars the harness sends, in universe order, with
float64 EMAs exactly like the kit's ema-cross baseline. Two independent
grade-local runs produce byte-identical action logs.
