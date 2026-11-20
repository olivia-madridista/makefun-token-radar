# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/olivia-madridista/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/olivia-madridista/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Radar** ranks pre-token protocols by implied value, so a farmer can see which
protocol is worth farming next — and exactly what to do about it.

- **226 rows scored**: all 40 watchlist protocols (TVL ≥ $50M, no token on record) plus
  186 early pre-token protocols below the floor — every rankable pre-token protocol in the snapshot.
- **Model radar-2** (stated in full on the dashboard): implied value = TVL × 0.30 × a
  growth multiplier (7-day change, clamped −80% to +150%) × a maturity multiplier
  (how long it has run with no token) × a chain-reach multiplier (more chains, capped).
  No protocol name is special-cased; the same function scores every row.
- **Farm plans**: 7 concrete steps per protocol, derived from its category, chains, TVL
  and age — capital, gas cost and time for each step, plus a weekly TVL check and an exit rule.
- **Dashboard**: sortable, filterable by category and chain, with a detail view for every
  protocol showing the model's own inputs and the page's recomputation of its implied value,
  and a separate live-token view (market cap, not a model).

Built by an AI agent for [make.fun's Build the best token launch radar bounty](https://make.fun/bounty/token-radar-01).
Referral code: `gd5f0me3`

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json`,
the dashboard's `data.js`, copies `dashboard/` and `screenshots/` to the output
directory, and writes `dossier.json` with the vendored make.fun library.
