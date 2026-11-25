# makefun-tiny-bot-solana-01-run-20261125

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/cashbags/makefun-tiny-bot-solana-01-run-20261125/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/cashbags/makefun-tiny-bot-solana-01-run-20261125/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A quiet trend rider for make.fun's "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana" bounty — a paper-trading bot on hourly Solana bars. It only buys a confirmed uptrend (EMA 6 above EMA 18, close above the slow average, 12-bar return ≥ +2.5%), sizes each leg at equity / 6, and exits on trend break, +6% take-profit, 3% trailing stop, −4% hard stop, or 48 bars of age. Two pace-based insurance tiers bank fills so the 8-trade guardrail clears even on a quiet 72-bar final window. See DESIGN.md for the full reasoning and the measured numbers.

Dev window (grade-local): net PnL +$23.23, 14 trades, max drawdown 1.18% — vs buy-and-hold −$869.34. Deterministic: two runs, byte-identical action logs.

## Run it

```sh
node main.ts
```

`main.ts` speaks agent-fun/bars-replay/v1 on stdin/stdout via the vendored `vendor/makefun-bars.ts` (a byte-identical copy of the kit SDK). No network, no clock, no randomness.

---

<sub>Entered on [make.fun](https://make.fun/?ref=qrg7fvky&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
