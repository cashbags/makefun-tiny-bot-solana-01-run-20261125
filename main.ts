// Quiet trend rider for the Solana hourly bars replay.
//
// What the tape says: the dev window is a broad down-drift (buy-and-hold
// -8.7%), and the resolved BTC-race winners won by riding one trend with
// 2 trades, not by scalping. Every kit baseline that trades a lot loses
// more; the ones that trade little lose least. So this bot is picky about
// entries, small about size, and quick to sit in cash — but it must still
// clear the 8-trade guardrail on a 72-bar final window it has never seen,
// in any regime. That tension shapes the whole design: a selective primary
// rule, plus two pace-based insurance tiers that only fire when the fill
// count is tracking below the guardrail.
//
// Primary entry (per symbol, long only, no leverage, no shorts):
//   - fast EMA(6) above slow EMA(18) and the close above the slow EMA,
//     and either the fast EMA just crossed above the slow one, or the
//     symbol exited at least 6 bars ago and its close is now above that
//     exit's price (a continuation re-entry while the trend holds);
//   - and momentum: the close is at least 2.5% above the close 12 bars
//     ago. A cross without a real move behind it is a whipsaw, and on
//     this tape whipsaws are where the money goes.
//   - size: equity / 6 per leg (about 16.7%), capped by the 25% weight
//     cap and by the cash left in this reply.
//
// Exits (whole position, sells sent before buys in the same reply):
//   - fast EMA crosses back below the slow EMA (trend break), or
//   - take-profit: position worth 6% over its cost, or
//   - trailing stop: close 3% below the highest close since entry, or
//   - hard stop: position worth 4% under its cost, or
//   - age: the leg is 48 bars old (long holds let a real trend pay; the
//     age exit only recycles a leg that has gone stale).
//
// Insurance tier 1, catch-up (from bar 24, while fewer than 10 fills are
// banked): entries drop the momentum confirm — any bar the trend is on
// (fast above slow) after the 6-bar cooldown — at equity / 16 per leg.
// Insurance tier 2, compliance (from bar 48, while fewer than 8 fills
// are banked and no buy was decided this bar): buy the least-bad symbol
// (best 12-bar return, even if negative), one leg per bar, at equity /
// 16. These are guardrail fills, not profit trades: on a one-way down
// window they are the only way to clear 8 trades, and each leg is small
// enough that the insurance costs far less than the buy-and-hold loss it
// protects against.
//
// Determinism: only the bars the harness sends decide the orders. No
// clock, no randomness, no environment reads, no network. EMAs run in
// float64 exactly like the kit's ema-cross baseline, so the same bars
// give the same orders on every run. The harness answers hello first,
// then one batch per bar; orders decided on a bar fill at the next bar's
// open, so every decision is made on closes already seen, and the fill
// count that arms the insurance tiers is read from each batch's fills.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 6;
const SLOW_BARS = 18;
const SLOTS = 6;
const REENTRY_COOLDOWN_BARS = 6;
const MOMENTUM_BARS = 12;
const MOMENTUM_MIN = 0.025;
const TAKE_PROFIT_NUM = 106n;
const TAKE_PROFIT_DEN = 100n;
const HARD_STOP_NUM = 96n;
const HARD_STOP_DEN = 100n;
const TRAIL_PCT = 0.97;
const MAX_HOLD_BARS = 48;
const MAX_SLIPPAGE_BPS = 100;
const CATCHUP_FROM_BAR = 24;
const CATCHUP_TARGET_TRADES = 10;
const CATCHUP_SLOTS = 16;
const COMPLY_FROM_BAR = 48;
const COMPLY_TARGET_TRADES = 8;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  gap: number | null;
  now: number | null;
  closes: number[];
  peak: number | null;
  entrySeq: number | null;
  lastExitSeq: number;
  lastExitPrice: number | null;
}

const series = new Map<string, Series>();
let filledTrades = 0;

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = {
      fast: { span: FAST_BARS, warm: [], value: null },
      slow: { span: SLOW_BARS, warm: [], value: null },
      gap: null, now: null, closes: [], peak: null, entrySeq: null, lastExitSeq: -1000, lastExitPrice: null,
    };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  step(s.fast, c);
  step(s.slow, c);
  s.gap = s.now;
  s.now = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
  s.closes.push(c);
  return s;
}

function uptrend(s: Series, bar: Bar): boolean {
  return s.now !== null && s.now > 0 && Number(bar.c) > (s.slow.value ?? Infinity);
}

function crossedUp(s: Series): boolean {
  return s.gap !== null && s.now !== null && s.now > 0 && s.gap <= 0;
}

/** 12-bar return, or null before 13 closes. */
function momentum(s: Series): number | null {
  if (s.closes.length <= MOMENTUM_BARS) return null;
  const now = s.closes[s.closes.length - 1]!;
  const then = s.closes[s.closes.length - 1 - MOMENTUM_BARS]!;
  return now / then - 1;
}

function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, s: Series, seq: number): boolean {
  if (s.now !== null && s.now < 0) return true;
  const value = state.value(symbol, held.qty);
  if (value * TAKE_PROFIT_DEN >= held.cost * TAKE_PROFIT_NUM) return true;
  if (value * HARD_STOP_DEN <= held.cost * HARD_STOP_NUM) return true;
  const peak = s.peak;
  const last = s.closes[s.closes.length - 1];
  if (peak !== null && last !== undefined && last < peak * TRAIL_PCT) return true;
  if (s.entrySeq !== null && seq - s.entrySeq >= MAX_HOLD_BARS) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    for (const fill of batch.fills) if (fill.status === 'filled') filledTrades++;
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      const s = push(bar);
      fresh.add(bar.symbol);
      const held = state.positions.get(bar.symbol);
      if (held !== undefined) {
        const c = Number(bar.c);
        if (s.peak === null || c > s.peak) s.peak = c;
      }
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: { symbol: string; catchUp: boolean }[] = [];
    const catchUpActive = batch.seq >= CATCHUP_FROM_BAR && filledTrades < CATCHUP_TARGET_TRADES;
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const s = series.get(symbol)!;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (exits(state, symbol, held, s, batch.seq)) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          s.lastExitSeq = batch.seq;
          s.lastExitPrice = Number(state.latest.get(symbol)!.c);
          s.peak = null;
          s.entrySeq = null;
        }
      } else if (uptrend(s, state.latest.get(symbol)!)) {
        const mom = momentum(s);
        const momOk = mom !== null && mom >= MOMENTUM_MIN;
        const cont =
          s.lastExitPrice !== null &&
          batch.seq - s.lastExitSeq >= REENTRY_COOLDOWN_BARS &&
          Number(state.latest.get(symbol)!.c) > s.lastExitPrice;
        const primary = (crossedUp(s) || cont) && momOk;
        const catchUpEntry = catchUpActive && (crossedUp(s) || batch.seq - s.lastExitSeq >= REENTRY_COOLDOWN_BARS);
        if (primary) entries.push({ symbol, catchUp: false });
        else if (catchUpEntry) entries.push({ symbol, catchUp: true });
      }
    }
    // Compliance tier: no uptrend buy was decided this bar, the fill count
    // is still below the guardrail, and the window is past bar 48 — buy
    // the least-bad symbol (best 12-bar return) at the small size.
    if (batch.seq >= COMPLY_FROM_BAR && filledTrades < COMPLY_TARGET_TRADES && entries.length === 0) {
      let best: string | null = null;
      let bestRet = -Infinity;
      for (const { symbol } of state.hello.symbols) {
        if (state.positions.has(symbol)) continue;
        const s = series.get(symbol);
        if (s === undefined) continue;
        const mom = momentum(s);
        if (mom === null) continue;
        if (mom > bestRet) { bestRet = mom; best = symbol; }
      }
      if (best !== null) entries.push({ symbol: best, catchUp: true });
    }

    const orders: OrderInput[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(SLOTS, caps.max_open_positions);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size + sells.length;
    let cash = state.cash;
    for (const { symbol, catchUp } of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      const divisor = catchUp ? CATCHUP_SLOTS : slots;
      let slice = state.equity / BigInt(divisor);
      if (slice > byWeight) slice = byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      const s = series.get(symbol)!;
      s.entrySeq = batch.seq;
      s.peak = Number(state.close(symbol));
      cash -= slice;
      room--;
    }
    return orders;
  },
});
