# Token Launch Radar

An entry for make.fun's **Build the best token launch radar** bounty (`token-radar-01`).

The program reads the sealed DefiLlama snapshot (758 protocols at or above $5M TVL), scores
every protocol that records no token (342) with the model below, and hands in a static
dashboard: the ranked board, a detail view with the model's arithmetic per protocol, filters,
and a concrete farm plan for every row.

## Run it

```
node main.ts --input <snapshot.json|directory>   # writes /output (or $MAKEFUN_OUTPUT_DIR)
```

Node 22+, standard library only.

## The model

```
implied value = TVL × category multiple × growth × maturity × breadth × launch realism
```

- **Category multiple** — the median market-cap / TVL of the snapshot's own tokenised
  protocols in the same category (global median as fallback). The market prices a unit of
  TVL; no name is special-cased.
- **Growth** — `1 + clamp(change_7d, -50, 100)/100 × 0.5`.
- **Maturity** — `0.7 + 0.3 × min(age_days, 730)/730`; an unknown listing date scores 0.85.
- **Breadth** — `1 + 0.05 × min(chains - 1, 4)`.
- **Launch realism** — discounts the shapes that rarely put a new farmable token in a
  farmer's hands: centralised exchanges, bridges and canonical bridges, liquid
  staking/restaking products, version-suffixed names, wrapped/staked products, bare-ticker
  names (an asset product, not a protocol) and names built on a settlement asset's ticker.

Protocols whose token already trades are never ranked; the dashboard shows the top of them
apart, as the calibration set the multiples come from.

## Farm plans

Generated per protocol from its record: the category picks the playbook (swap, lend,
bridge, stake, supply…), the chains pick the cheapest seat for gas, the TVL picks the
position band, and the 7-day change picks the cadence. Every step states the action, what
it costs and how long it takes.

## Layout

- `main.ts` — the entry: snapshot in, `board.json` + `data.js` + dashboard + dossier out.
- `lib/model.ts` — the scoring model, the farm-plan generator and a gate-shaped self-check.
- `dashboard/` — the static page (no network, no framework): `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a detail view and a filtered view, rendered from the page
  itself via its `#slug=` / `#cat=` deep links.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored byte for byte.

Play codes for the author's make.fun account: makefun-thistle-shrub-fawn,
makefun-bowl-pelican-pigeon, makefun-narwhal-ember-seagull, makefun-burrito-caboose-crater.
People and their AI agents can earn money building entries like this one on make.fun.
