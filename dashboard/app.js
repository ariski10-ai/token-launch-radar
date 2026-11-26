// Token Launch Radar — the page's whole logic. Reads window.RADAR (written by the entry's
// program from the sealed snapshot), renders the ranked board, the filters and one
// protocol's detail with its farm plan. No network, no framework: the dossier is the page.
//
// The board's order is the model's rank; the sort control re-sorts the view, never the
// ranks. A row's detail shows the model's own arithmetic for that protocol, so a reader
// can check the number instead of trusting it.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const state = { q: '', cat: 'all', chain: 'all', sort: 'value', wl: false, selected: null };

// Deep links for a chosen view, e.g. #cat=Lending or #slug=gauntlet: the screenshots the
// entry hands in are rendered from these, so the pictures and the code cannot drift apart.
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('cat')) state.cat = h.get('cat');
  if (h.get('chain')) state.chain = h.get('chain');
  if (h.get('q')) state.q = h.get('q');
  if (h.get('wl') === '1') state.wl = true;
  if (h.get('sort')) state.sort = h.get('sort');
  if (h.get('slug')) state.selected = h.get('slug');
}

function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function fmtPct(x) {
  if (x === null || x === undefined) return '—';
  const cls = x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  return `<span class="${cls}">${x > 0 ? '+' : ''}${x.toFixed(1)}%</span>`;
}
function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderStats() {
  const top = R.rows[0];
  $('stats').innerHTML = [
    [R.pre_token.toLocaleString('en-US'), 'pre-token ranked'],
    [String(R.watchlist_size), 'watchlist covered'],
    [R.live_size.toLocaleString('en-US'), 'already trading'],
    [top ? fmtUsd(top.implied_value_usd) : '—', 'top implied value'],
    [R.as_of, 'snapshot date'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
  $('model-notes').innerHTML = R.model_notes.map((n) => `<li>${esc(n)}</li>`).join('');
  $('foot-note').textContent =
    `Snapshot of ${R.total_protocols} protocols at or above $5M TVL (DefiLlama, frozen ${R.as_of}). ` +
    `Implied value is this radar's own claim about a launch that may never happen; it is not a prediction.`;
}

function fillFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category || 'Uncategorised'))].sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' +
    cats.map((c) => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="all">All chains</option>' +
    chains.map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('q').value = state.q;
  $('wl').checked = state.wl;
  $('sort').value = state.sort;
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) =>
    (state.cat === 'all' || (r.category || 'Uncategorised') === state.cat) &&
    (state.chain === 'all' || r.chains.includes(state.chain)) &&
    (!state.wl || r.watchlist) &&
    (q === '' || r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q)));
  const by = {
    value: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  }[state.sort];
  return rows.sort(by);
}

function renderBoard() {
  const rows = visibleRows();
  const topValue = R.rows[0] ? R.rows[0].implied_value_usd : 1;
  $('rows').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${r.slug === state.selected ? 'selected' : ''}">
      <td class="num rank">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}</td>
      <td>${esc(r.category || 'Uncategorised')}</td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num">${fmtPct(r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num"><b>${fmtUsd(r.implied_value_usd)}</b></td>
      <td class="bar-cell"><div class="bar"><i style="width:${Math.max(1.5, (r.implied_value_usd / topValue) * 100)}%"></i></div></td>
    </tr>`).join('');
  $('empty').hidden = rows.length > 0;
  $('count').textContent = `${rows.length} of ${R.rows.length} protocols shown`;
  for (const tr of document.querySelectorAll('#rows tr')) {
    tr.addEventListener('click', () => { state.selected = tr.dataset.slug; renderBoard(); renderDetail(); });
  }
}

// The detail view: the model's arithmetic for this one protocol, then its farm plan.
function renderDetail() {
  const r = R.rows.find((x) => x.slug === state.selected) || R.rows[0];
  if (!r) { $('detail').innerHTML = ''; return; }
  state.selected = r.slug;
  const p = r.score_parts;
  $('detail').innerHTML = `
    <h2>${esc(r.name)}</h2>
    <p class="sub">Rank #${r.rank} of ${R.rows.length} · ${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', '))}${r.watchlist ? ' · on the snapshot watchlist' : ''}</p>
    <div class="kv">
      <div><span>Implied value</span><b>${fmtUsd(r.implied_value_usd)}</b></div>
      <div><span>TVL</span><b>${fmtUsd(r.tvl_usd)}</b></div>
      <div><span>7-day change</span><b>${r.change_7d === null ? '—' : `${r.change_7d.toFixed(1)}%`}</b></div>
      <div><span>Track record</span><b>${r.age_days === null ? 'unknown' : `${r.age_days.toLocaleString('en-US')} days`}</b></div>
    </div>
    <h3>How this number is built</h3>
    <p class="math">TVL <b>${fmtUsd(r.tvl_usd)}</b> × category multiple <b>${r.multiple.toFixed(2)}</b>
    = <b>${fmtUsd(p.base)}</b><br>
    × growth <b>${p.growth.toFixed(2)}</b> × maturity <b>${p.maturity.toFixed(2)}</b>
    × breadth <b>${p.breadth.toFixed(2)}</b> × launch realism <b>${r.realism.toFixed(2)}</b>
    = <b>${fmtUsd(r.implied_value_usd)}</b></p>
    <h3>Farm plan</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

function renderLive() {
  $('live-grid').innerHTML = R.live.slice(0, 18).map((l) => `
    <div class="live-card"><b>${esc(l.name)}${l.symbol ? ` · ${esc(l.symbol)}` : ''}</b>
    <span>mcap ${fmtUsd(l.mcap_usd)} · TVL ${fmtUsd(l.tvl_usd)} · ${l.ratio.toFixed(2)}× TVL</span></div>`).join('');
}

function bind() {
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  $('wl').addEventListener('change', (e) => { state.wl = e.target.checked; renderBoard(); });
}

readHash();
if (!state.selected && R.rows[0]) state.selected = R.rows[0].slug;
renderStats();
fillFilters();
renderBoard();
renderDetail();
renderLive();
bind();
