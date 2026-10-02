# fomi — brain open

```
███████╗ ██████╗ ███╗   ███╗██╗
██╔════╝██╔═══██╗████╗ ████║██║
█████╗  ██║   ██║██╔████╔██║██║
██╔══╝  ██║   ██║██║╚██╔╝██║██║
██║     ╚██████╔╝██║ ╚═╝ ██║██║
╚═╝      ╚═════╝ ╚═╝     ╚═╝╚═╝
```

fomi is an autonomous ai agent that trades solana memecoins on **fomo**, starting with **5 sol**.
her screen, her brain, her bank and every rule she follows are public.

- **site** (`docs/`) — two live screens (her phone running the fomo app + her research), a 3d ascii projection of her brain, bank, positions, journal
- **phone** (`brain/phone/`) — fomo has no api, so she trades the way people do: on a phone. a vmos cloud android runs the fomo app 24/7; she taps through it via the vmos openapi (live preview, adb shell taps, text input)
- **brain** (`brain/`) — scanner, 7 signals, llm decision + thesis, bank management, learning
- **memory** (`brain/data/`) — journal, weights, lessons; committed on every tick, so the repo *is* her history

## how she decides

1. **scan** trending solana tokens on gmgn (official `gmgn-cli`, read-only key) — prices and trades from dexscreener; without a gmgn key, dexscreener profiles + boosts
2. **read** the screener row, mentions on x, theses on the fomo feed
3. **score** 8 signals, 0..1 each: momentum, volume, buyers, liquidity, freshness, social, smart money (gmgn smart / kol wallets), safety (incl. gmgn rug ratio, top-10 holders, bundlers, dev status, mint/freeze). wash trading or rug ratio > 0.3 → rejected outright
4. **decide** — weighted score vs threshold; a small llm (claude haiku by default) makes the final call and writes the thesis. hard risk rules always override the model
5. **size** — 6% of the tradable bank × conviction, 0.1–0.5 sol
6. **trade on the phone** — open fomo, paste the contract, type the amount, check the ticker on the confirm screen, confirm, post the thesis
7. **exit** — stop −25%, sell half at +60% (stop → breakeven), rest at +200%, trailing 35%, time stop 8h
8. **learn** — every closed trade nudges signal weights toward what worked; threshold adapts to win rate. each update is a new brain generation

## bank rules (`brain/bank.js`)

| rule | value |
|---|---|
| start | 5 sol |
| untouchable reserve | 1 sol |
| position size | 0.1–0.5 sol |
| max open / max in market | 4 / 50% of tradable |
| daily loss limit | −0.75 sol → stop for the day |
| loss streak | 3 in a row → 2h cooldown |
| hard halt | equity < 2.5 sol → stops until `npm run resume` |

## run it

```bash
cp .env.example .env
npm run mock        # one tick on a fake market, no internet, no keys
npm run tick        # one tick on real dexscreener data (paper money)
npm run brain       # run forever, tick every TICK_SECONDS
npm run live        # brain + phone + site at http://localhost:8787
```

### executors

| `EXECUTOR` | what happens |
|---|---|
| `paper` (default) | real prices, virtual money, fees + slippage simulated |
| `manual` | she queues orders; you buy on fomo and confirm: `npm run confirm -- <orderId> [priceSol]` |
| `phone` | she trades in the fomo app on a cloud phone. `PHONE_DRY_RUN=1` (default) walks the whole flow but never presses the final confirm |

### the phone

```bash
# 1. vmos cloud phone with the fomo app installed and logged in; VMOS_AK / VMOS_SK / VMOS_PAD_CODE in .env
npm run phone:ping                       # checks keys, saves one live frame to brain/data/phone/ping.jpg
# 2. map the app's buttons once:
npm run phone:snap                       # saves screen + every button with its text to brain/data/phone/
#    → fill brain/phone/fomo-ui.json (package name + selectors)
npm run phone:test -- <CA> <SYMBOL> 0.1  # dry run: walks the buy flow without confirming
# 3. run everything live (brain + phone frames + event stream for the site):
EXECUTOR=phone npm run live
npm run stop / npm run unstop            # emergency stop for any phone action
```

safety on the phone: hard cap of `MAX_POSITION_SOL` per order, ticker check on the confirm screen, dry run by default, `STOP` file kill switch.

### live site

set `CONFIG.liveUrl` in `docs/index.html` to your live server (`npm run live`, port 8787, put it behind https). the site then shows the phone screen in real time, her taps, and new decisions the moment she makes them. without it, the site reads `docs/state.json`, and without that, it runs a labelled demo.

## deploy

1. push this repo to github
2. **settings → pages**: deploy from branch `main`, folder `/docs`
3. **settings → secrets and variables → actions**:
   - secrets: `ANTHROPIC_API_KEY`, optionally `X_USER_TOKEN`, `X_BEARER_TOKEN`, `FOMO_API_KEY`
   - variables: `FOMO_URL`, `X_HANDLE`, `EXECUTOR` (paper / manual), `X_POST` (0 / 1)
4. the `fomi-brain` workflow ticks every 15 minutes in paper mode and commits `brain/data` + `docs/state.json`; the site picks it up
5. for phone trading and the live screens, run `npm run live` on a small vps instead (see `Dockerfile`)

without `docs/state.json` the site runs a clearly-labelled demo feed.

## safety

- never commit wallet keys. this repo has no wallet code on purpose: the wallet lives inside the fomo app on the phone
- automating an app may be against its terms — talk to the fomo team before going live
- use a dedicated wallet holding only her bank
- x requires automated accounts to be labelled as automated — turn that on in the account settings
- fomi loses money too. nothing she posts is financial advice

MIT
