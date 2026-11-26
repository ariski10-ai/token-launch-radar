// Token Launch Radar model: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token in the snapshot (342 of 758) by an
// implied value: what a launch could plausibly be worth if the protocol's record stayed as it
// is. Protocols whose token already trades are never ranked; the dashboard shows them apart,
// as the comparable set the model is calibrated on.
//
// The model uses only the snapshot's own figures:
//
//   multiple   = the median market-cap / TVL ratio of the snapshot's tokenised protocols in
//                the same category (the market's own pricing of a unit of TVL, per category);
//                categories with too few tokenised peers fall back to the global median.
//   growth     = 1 + clamp(change_7d, -50, 100) / 100 x 0.5   (a hot week lifts, a bad week cuts)
//   maturity   = 0.7 + 0.3 x min(age_days, 730) / 730          (two years of record, full credit;
//                an unknown listing date scores a neutral 0.85 inside the same formula)
//   breadth    = 1 + 0.05 x min(chains - 1, 4)                 (more chains, wider distribution)
//   realism    = a launch-realism factor from category and name shape: centralised exchanges,
//                canonical bridges and wrapped or staked products of an asset that already
//                trades rarely put a new farmable token in a farmer's hands, so the model
//                discounts them (the same shapes the snapshot's watchlist rule sets aside).
//   implied    = round(tvl x multiple x growth x maturity x breadth x realism), at least $1.
//
// No protocol name is ever special-cased: one function scores every row from its record.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One board row, as board.json carries it (extra keys ride along for the dashboard). */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  realism: number;
  score_parts: { base: number; growth: number; maturity: number; breadth: number };
}

/** A tokenised protocol, kept apart as a calibration comparable. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  pre_token: number;
  live_size: number;
  watchlist_size: number;
  global_multiple: number;
  category_multiples: Record<string, number>;
  rows: BoardRow[];
  live: LiveRow[];
  model_notes: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** A protocol records no token when all three token fields are empty. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Median mcap/TVL per category over the snapshot's tokenised protocols, plus the global one. */
export function categoryMultiples(snapshot: Snapshot): { per: Record<string, number>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = clamp(median(all), 0.05, 20);
  const per: Record<string, number> = {};
  for (const [key, list] of byCategory) {
    per[key] = list.length >= 3 ? clamp(median(list), 0.05, 20) : global;
  }
  return { per, global };
}

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const TICKER_NAME = /^[A-Z0-9]{2,6}$/;
const ASSET_WORD = /\b(BTC|ETH|SOL|USDT|USDC|DAI)\b/;

/** Launch-realism factor from category and name shape alone, in (0, 1]. */
export function launchRealism(p: SnapshotProtocol): number {
  let realism = 1;
  const category = p.category ?? '';
  if (category === 'CEX') realism *= 0.15;
  if (category === 'Bridge') realism *= 0.2;
  if (category === 'Canonical Bridge') realism *= 0.15;
  if (category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC') realism *= 0.5;
  if (VERSION_SUFFIX.test(p.name)) realism *= 0.6;
  if (WRAPPED_WORD.test(p.name)) realism *= 0.5;
  if (EXCHANGE_PREFIX.test(p.name)) realism *= 0.3;
  // A bare ticker for a name (WBTC, USDT0) is an asset product, not a protocol brand:
  // the asset already trades, so there is no separate launch for a farmer to earn.
  if (TICKER_NAME.test(p.name)) realism *= 0.2;
  // A name built on a settlement asset's ticker (Binance Bitcoin, an ETH product) is a
  // product of that asset first and a launch candidate second.
  if (ASSET_WORD.test(p.name)) realism *= 0.4;
  return clamp(realism, 0.05, 1);
}

/** Whole days from listed_at to the snapshot's as_of; null when the date is unknown. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

// ---- Farm plans -------------------------------------------------------------
//
// Every plan is generated from the protocol's own record: its category picks the playbook,
// its chains pick where the gas is cheapest, its TVL picks the position size a farmer can
// move without becoming the market, and its 7-day change picks the cadence. Each step states
// the action, what it costs and how long it takes.

/** Rough per-transaction gas in USD by chain, cheapest first; unlisted chains use the default. */
const GAS_USD: Record<string, number> = {
  Polygon: 0.01, Solana: 0.02, Base: 0.05, Arbitrum: 0.1, Optimism: 0.1, zkSync: 0.1,
  Linea: 0.15, BSC: 0.2, Avalanche: 0.25, Ethereum: 4, Bitcoin: 1.5,
};
const DEFAULT_GAS = 0.5;

function cheapestChain(chains: string[]): string {
  let best = chains[0] ?? 'Ethereum';
  let bestCost = Number.POSITIVE_INFINITY;
  for (const chain of chains) {
    const cost = GAS_USD[chain] ?? DEFAULT_GAS;
    if (cost < bestCost) {
      bestCost = cost;
      best = chain;
    }
  }
  return best;
}

function gasOf(chain: string): number {
  return GAS_USD[chain] ?? DEFAULT_GAS;
}

/** A position size scaled to the protocol's TVL: large enough to matter, small enough to exit. */
function sizeBand(tvl: number): { lo: number; hi: number; label: string } {
  if (tvl >= 1_000_000_000) return { lo: 1000, hi: 5000, label: '$1,000-$5,000' };
  if (tvl >= 100_000_000) return { lo: 500, hi: 2000, label: '$500-$2,000' };
  if (tvl >= 10_000_000) return { lo: 100, hi: 500, label: '$100-$500' };
  return { lo: 25, hi: 100, label: '$25-$100' };
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

interface Playbook {
  core: string;
  second: string;
  verb: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: {
    core: 'swap between the deepest pairs (for example ETH and a major stablecoin) in varied sizes',
    second: 'add a small liquidity position in a top pair and leave it in range',
    verb: 'trade',
  },
  Lending: {
    core: 'supply a major asset (ETH or a stablecoin) as collateral and keep it supplied',
    second: 'borrow a modest amount against the collateral and repay on a cycle, staying well above the liquidation line',
    verb: 'lend',
  },
  Derivatives: {
    core: 'open small hedged perpetual positions and close them the same day',
    second: 'post margin and trade a second market the protocol lists, keeping leverage at or under 2x',
    verb: 'trade',
  },
  Bridge: {
    core: 'bridge a major asset to a chain the protocol serves and bridge it back on a later day',
    second: 'route a second transfer through a different corridor the bridge supports',
    verb: 'bridge',
  },
  'Canonical Bridge': {
    core: 'bridge a major asset from Ethereum to the chain this bridge serves and keep it there',
    second: 'use the bridged funds in the destination chain\u2019s core apps, then bridge a portion back',
    verb: 'bridge',
  },
  Yield: {
    core: 'deposit a major asset into the protocol\u2019s main vault and keep the position open',
    second: 'move a smaller amount into a second vault or strategy the protocol offers',
    verb: 'deposit',
  },
  'Yield Aggregator': {
    core: 'deposit a major asset into the protocol\u2019s main vault and keep the position open',
    second: 'rotate a smaller amount between two vaults the aggregator runs',
    verb: 'deposit',
  },
  'Liquid Staking': {
    core: 'stake a major asset through the protocol and hold the liquid staking token it issues',
    second: 'use the staking token in one integrated lending or liquidity market',
    verb: 'stake',
  },
  'Liquid Restaking': {
    core: 'restake a liquid staking token through the protocol and hold the position',
    second: 'delegate or allocate to a second operator or strategy the protocol lists',
    verb: 'restake',
  },
  'Risk Curators': {
    core: 'supply a major asset to a vault the curator manages and keep it supplied',
    second: 'split a smaller amount across a second curated vault with a different risk profile',
    verb: 'supply',
  },
  'Onchain Capital Allocator': {
    core: 'supply a major asset to an allocation vault and keep it supplied',
    second: 'allocate a smaller amount to a second strategy the allocator routes to',
    verb: 'supply',
  },
  RWA: {
    core: 'buy or deposit into the protocol\u2019s main real-world-asset product and hold it',
    second: 'add a second, smaller position in another asset the protocol tokenises',
    verb: 'invest',
  },
  CEX: {
    core: 'keep a modest balance on the exchange and trade spot pairs with it',
    second: 'use one further product the exchange offers (earn, convert or a launchpool when open)',
    verb: 'trade',
  },
};

const GENERIC: Playbook = {
  core: 'use the protocol\u2019s main product with a major asset (ETH or a stablecoin) and keep the position open',
  second: 'use a second feature or market the protocol offers, with a smaller amount',
  verb: 'use',
};

/** The generated farm plan for one protocol: 6 steps, each with cost and time. */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const book = PLAYBOOKS[p.category ?? ''] ?? GENERIC;
  const chain = cheapestChain(p.chains);
  const gas = gasOf(chain);
  const size = sizeBand(p.tvl_usd);
  const age = ageDays(p, asOf);
  const hot = p.change_7d !== null && p.change_7d >= 10;
  const weeks = hot ? 4 : 8;
  const txPerWeek = 3;
  const gasBudget = gas * txPerWeek * weeks;
  const chainsNote = p.chains.length > 1
    ? ` It runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? ' and more' : ''}); ${chain} is the cheapest seat at about ${money(gas)} a transaction.`
    : ` It runs on ${chain}, at about ${money(gas)} a transaction.`;
  const ageNote = age === null
    ? 'DefiLlama gives no listing date for it, so treat its track record as unproven and size down.'
    : `It has been tracked for ${age.toLocaleString('en-US')} days with no token recorded, so the position has time to season.`;
  return [
    `Set up one wallet for ${p.name} and fund it on ${chain} with ${size.label} plus about ${money(gasBudget + gas * 4)} set aside for gas. Cost: the gas reserve only. Time: about 20 minutes, once.`,
    `Make the core move: ${book.core} on ${p.name}, sized inside the ${size.label} band. Cost: about ${money(gas)} a transaction in gas. Time: about 10 minutes for the first position.`,
    `Stay active for ${weeks} weeks: ${book.verb} ${txPerWeek} times a week with varied amounts and times of day, never the same size twice. Cost: about ${money(gas * txPerWeek)} a week in gas. Time: about 15 minutes a week.`,
    `Open the second surface: ${book.second}. Cost: about ${money(gas * 2)} in gas to open and close. Time: about 15 minutes, then it runs alongside the core position.`,
    `Keep the record clean: log every transaction hash, date and amount in one sheet, and keep total exposure inside the ${size.label} band. ${ageNote} Cost: nothing. Time: about 5 minutes a week.`,
    `Watch for the launch signal: a token announcement, a points program or a snapshot date from ${p.name}. Until one lands, keep the weekly cadence; if TVL falls for three straight weeks, halve the position. Cost: nothing. Time: one check a week, about 5 minutes.${chainsNote}`,
  ];
}

// ---- The board ---------------------------------------------------------------

/** Score every pre-token protocol and build the ranked board plus the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { per, global } = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const multiple = per[p.category ?? 'Uncategorised'] ?? global;
    const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, -50, 100);
    const growth = 1 + (growthPct / 100) * 0.5;
    const age = ageDays(p, snapshot.as_of);
    const maturity = age === null ? 0.85 : 0.7 + 0.3 * Math.min(age, 730) / 730;
    const breadth = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 4);
    const realism = launchRealism(p);
    const base = p.tvl_usd * multiple;
    const implied = Math.max(1, Math.round(base * growth * maturity * breadth * realism));
    rows.push({
      slug: p.slug, name: p.name, rank: 0, implied_value_usd: implied,
      farm_steps: farmSteps(p, snapshot.as_of),
      category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
      age_days: age, watchlist: watch.has(p.slug), multiple, realism,
      score_parts: { base, growth, maturity, breadth },
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  rows.forEach((row, i) => { row.rank = i + 1; });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!,
      ratio: p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 60);

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    pre_token: rows.length,
    live_size: snapshot.protocols.length - rows.length,
    watchlist_size: snapshot.watchlist.length,
    global_multiple: global,
    category_multiples: per,
    rows,
    live,
    model_notes: [
      'Implied value = TVL x category multiple x growth x maturity x breadth x launch realism.',
      'The category multiple is the median market-cap / TVL of the snapshot\u2019s own tokenised protocols in that category.',
      'Growth uses the 7-day TVL change clamped to -50%..+100%; maturity reaches full credit at two years of record.',
      'Launch realism discounts exchanges, bridges and wrapped or staked products of assets that already trade.',
      'No protocol name is special-cased; every row is scored by the same function from its own record.',
    ],
  };
  return { board: rows, radar };
}

/** The data.js the dashboard loads: the whole radar as one script assignment. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** A gate-shaped self-check: returns the first problem found, or null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i}: slug ${row.slug} repeats`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i}: rank is ${row.rank}, expected ${i + 1}`;
    if (!(row.implied_value_usd >= 1) || row.implied_value_usd > 100_000_000_000_000) return `row ${i}: implied value out of range`;
    if (row.implied_value_usd > previous) return `row ${i}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i}: farm_steps holds ${row.farm_steps.length} steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
