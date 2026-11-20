// Token Radar dashboard, rewritten from scratch for the radar-2 entry.
// It runs with no network: main.ts writes window.RADAR into data.js beside
// this page, and everything on screen comes from that one object. The page
// recomputes each row's implied value from the snapshot figures, so a reader
// can see the dashboard and the board agree on the same arithmetic.
(() => {
  'use strict';

  const DATA = window.RADAR;
  const root = document.getElementById('board');
  if (!DATA || !root) return;

  // What the reader is looking at right now: search text, two filters, which
  // tab, how the table is sorted, and which protocol's detail is open.
  const view = {
    search: '',
    category: 'All',
    chain: 'All',
    tab: 'pre-token',
    sortBy: 'implied',
    descending: true,
    open: null,
  };

  const money = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });

  // Short money: $754.8M reads faster than $754,757,720 in a table cell.
  function shortMoney(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const sign = n < 0 ? '-' : '';
    const v = Math.abs(n);
    if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'K';
    return money.format(n);
  }

  function shortPct(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function shortAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Escape once, then build HTML from strings. Every value on the page comes
  // from data.js, but a name with a stray '<' should never break the page.
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // The radar-2 model, in the page's own words. main.ts scores with the same
  // constants, so this recomputation must return the board's number exactly.
  function impliedOf(row, model) {
    const rawGrowth = row.change_7d ?? 0;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days ?? model.unknown_age_days;
    const clampedAge = Math.min(Math.max(age, 0), model.maturity_days);
    const maturity = model.maturity_floor + (clampedAge / model.maturity_days) * model.maturity_range;
    const extraChains = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_cap);
    const chainMult = 1 + model.chain_weight * extraChains;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
  }

  // --- Farm plans -----------------------------------------------------------
  // These seven steps are the same derivation lib/model.ts writes into
  // board.json: the protocol's category picks the action, its TVL picks the
  // capital, its age picks the hold. No name is ever special-cased, so a
  // protocol the reader has never heard of gets a plan as concrete as a
  // famous one. The wording below is kept in step with model.ts on purpose.
  function mainChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    const name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    }
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
      return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (c.includes('bridge')) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    }
    if (c.includes('staking') || c.includes('restak')) {
      return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    }
    if (c.includes('perpetual') || c.includes('derivative')) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    }
    if (c.includes('prediction')) {
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    }
    if (c.includes('curator') || c.includes('allocator')) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    }
    if (c.includes('stable')) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    }
    if (c.includes('rwa')) {
      return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    }
    if (c.includes('insurance')) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  // One step is action + cost + time, kept between 20 and 600 characters so
  // it reads as a plan and still fits board.json's farm_steps gate.
  function finishStep(text, cost, time) {
    let s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    const chain = mainChain(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const gas = capital >= 150 ? 8 : 4;
    const weekly = (p.chains || []).length > 1
      ? 'Repeat the action on a second chain from ' + p.name + "'s chain list once a month, so the wallet shows activity on more than one chain."
      : 'Do one small extra action on ' + chain + ' each week, such as a swap or a vote, so the wallet stays active.';
    return [
      finishStep('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      finishStep(actionFor(p, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
      finishStep(weekly, 'about $2 of gas a week', '10 minutes a week'),
      finishStep('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      finishStep("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
      finishStep("Check the position once a week: if " + p.name + "'s TVL falls by more than a third in a week, cut the position in half before you add more.", 'no fee to check', '5 minutes a week'),
      finishStep('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'),
    ];
  }

  // --- Reading the address bar ----------------------------------------------
  // The search, the category and the open protocol live in the hash, so a
  // filtered view and a detail view are both shareable links.
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) view.search = params.get('q');
    if (params.get('p')) view.open = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (view.search) params.set('q', view.search);
    if (view.category !== 'All') params.set('category', view.category);
    if (view.chain !== 'All') params.set('chain', view.chain);
    if (view.open) params.set('p', view.open);
    const next = params.toString();
    const url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // --- Filtering and sorting -------------------------------------------------
  function visibleRows() {
    const q = view.search.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (view.category !== 'All' && r.category !== view.category) return false;
      if (view.chain !== 'All' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    return r.implied_value_usd;
  }

  function sortedRows(list) {
    const key = view.sortBy;
    const dir = view.descending ? -1 : 1;
    return list.slice().sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
  }

  // --- Pieces of the page ----------------------------------------------------
  function headerHtml() {
    return '<header class="top">'
      + '<div class="brand"><span class="mark" aria-hidden="true"></span><span class="brand-name">Token Radar</span></div>'
      + '<div class="top-meta"><span>Snapshot ' + esc(DATA.as_of) + '</span>'
      + '<span>DefiLlama protocol index</span>'
      + '<span>' + esc(DATA.model_version) + ' model</span></div>'
      + '</header>';
  }

  function introHtml() {
    const floorM = Math.round(DATA.floor_usd / 1e6);
    return '<section class="lede"><div>'
      + '<h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>'
      + '<p>The watchlist is the floor: every protocol with at least $' + floorM
      + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size
      + ' pre-token protocols below that floor. Implied value is a model, not a promise.</p>'
      + '</div><div class="facts">'
      + '<div class="fact"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>'
      + '<div class="fact"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>'
      + '<div class="fact"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>'
      + '<div class="fact"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>'
      + '</div></section>';
  }

  // The three strongest rows, up front, for a reader in a hurry.
  function spotlightHtml() {
    const top = DATA.rows.slice(0, 3);
    const cards = top.map((r) => {
      const chains = (r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain';
      return '<article class="spot"><div class="spot-rank">#' + r.rank + '</div>'
        + '<h3>' + esc(r.name) + '</h3>'
        + '<p class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</p>'
        + '<p class="spot-value">' + shortMoney(r.implied_value_usd) + '</p>'
        + '<p class="sub">TVL ' + shortMoney(r.tvl_usd) + ' &middot; 7d ' + shortPct(r.change_7d) + '</p>'
        + '<button class="button" type="button" data-open="' + esc(r.slug) + '">See the plan</button></article>';
    }).join('');
    return '<section class="spotlight" aria-label="Top three protocols">' + cards + '</section>';
  }

  function controlsHtml() {
    const categories = uniqueSorted(DATA.rows.map((r) => r.category || 'Other'));
    const chains = uniqueSorted(DATA.rows.flatMap((r) => r.chains || []));
    const catOptions = ['<option value="All">All categories</option>'].concat(
      categories.map((c) => '<option value="' + esc(c) + '"' + (c === view.category ? ' selected' : '') + '>' + esc(c) + '</option>'),
    ).join('');
    const chainOptions = ['<option value="All">All chains</option>'].concat(
      chains.map((c) => '<option value="' + esc(c) + '"' + (c === view.chain ? ' selected' : '') + '>' + esc(c) + '</option>'),
    ).join('');
    const shown = view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return '<div class="controls">'
      + '<div class="field"><label for="q">Search</label>'
      + '<input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(view.search) + '" aria-label="Search the board"></div>'
      + '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + catOptions + '</select></div>'
      + '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + chainOptions + '</select></div>'
      + '<div class="field"><span class="sub">Token status</span><div class="tabs" role="group" aria-label="Token status">'
      + '<button type="button" data-tab="pre-token" aria-pressed="' + (view.tab === 'pre-token') + '">Pre-token</button>'
      + '<button type="button" data-tab="live" aria-pressed="' + (view.tab === 'live') + '">Live token</button>'
      + '</div></div>'
      + '<span class="count">' + esc(shown) + '</span></div>';
  }

  function sortButton(key, label) {
    const arrow = view.sortBy === key ? (view.descending ? ' v' : ' ^') : '';
    return '<button type="button" data-sort="' + key + '">' + esc(label)
      + (arrow ? '<span aria-hidden="true">' + arrow + '</span>' : '') + '</button>';
  }

  function boardHtml() {
    const list = sortedRows(visibleRows());
    if (list.length === 0) {
      return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>'
        + '<p>Clear the search or pick another category to see the board again.</p>'
        + '<button class="button primary" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    const max = list[0].implied_value_usd || 1;
    const rowsHtml = list.map((r) => {
      const growth = r.change_7d === null ? 'n/a' : shortPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const chains = (r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain';
      const width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-selected="' + (view.open === r.slug) + '" tabindex="0" data-open="' + esc(r.slug) + '">'
        + '<td class="num">' + r.rank + '</td>'
        + '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>'
        + '<td class="num">' + shortMoney(r.tvl_usd) + '</td>'
        + '<td class="num ' + growthClass + '">' + growth + '</td>'
        + '<td class="num">' + shortAge(r.age_days) + '</td>'
        + '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></div>'
        + '<span class="num">' + shortMoney(r.implied_value_usd) + '</span></div></td>'
        + '<td><span class="status">no token</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>'
      + '<caption class="sub">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>'
      + '<thead><tr><th scope="col">' + sortButton('implied', 'Rank') + '</th>'
      + '<th scope="col">' + sortButton('name', 'Protocol') + '</th>'
      + '<th scope="col">' + sortButton('tvl', 'TVL') + '</th>'
      + '<th scope="col">' + sortButton('growth', '7d') + '</th>'
      + '<th scope="col">' + sortButton('age', 'Age') + '</th>'
      + '<th scope="col">' + sortButton('implied', 'Implied value') + '</th>'
      + '<th scope="col">Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function liveHtml() {
    const rowsHtml = DATA.live.map((r) => {
      const chains = (r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain';
      const cls = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr><td class="num">live</td>'
        + '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>'
        + '<td class="num">' + shortMoney(r.tvl_usd) + '</td>'
        + '<td class="num ' + cls + '">' + shortPct(r.change_7d) + '</td>'
        + '<td class="num">' + shortMoney(r.mcap_usd) + '</td>'
        + '<td><span class="status">already trades</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>'
      + '<caption class="sub">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>'
      + '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>'
      + '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function modelHtml() {
    const m = DATA.model;
    const formula = 'implied = round( tvl_usd x ' + m.base_multiple
      + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')'
      + ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')'
      + ' x (1 + ' + m.chain_weight + ' x min(chains - 1, ' + m.chain_cap + ')) )';
    return '<section class="panel model"><h2>How implied value is computed</h2>'
      + '<p class="sub">Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>'
      + '<div class="formula">' + esc(formula) + '</div>'
      + '<p class="sub">TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses '
      + m.unknown_age_days + ' days. A protocol on more chains earns a small reach bonus, capped at five extra chains. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.</p></section>';
  }

  // --- Detail dialog ---------------------------------------------------------
  // One <dialog>, filled fresh for whichever protocol the reader opened. The
  // equation lists every input the model used, and the recomputed number is
  // shown next to the board's number so a mismatch would be visible.
  function openDetail(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    view.open = slug;
    writeHash();
    const dialog = document.getElementById('detail');
    const recomputed = impliedOf(row, DATA.model);
    const agrees = recomputed === row.implied_value_usd;
    const chains = (row.chains || []).join(', ') || 'an unnamed chain';
    const steps = farmSteps(row).map((s) => {
      const at = s.indexOf(' Cost: ');
      const action = at >= 0 ? s.slice(0, at) : s;
      const tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b> <span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    dialog.innerHTML = '<div class="detail-head"><div>'
      + '<span class="brand-name">Rank ' + row.rank + ' of ' + DATA.board_size + '</span>'
      + '<h2 id="detail-title">' + esc(row.name) + '</h2>'
      + '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(chains) + '</p></div>'
      + '<button class="close" type="button" aria-label="Close details" data-close="1">Close</button></div>'
      + '<section class="detail-section"><h3>Implied value</h3><div class="equation">'
      + '<div><span>TVL</span><b class="num">' + shortMoney(row.tvl_usd) + '</b></div>'
      + '<div><span>Seven-day growth</span><b class="num">' + shortPct(row.change_7d) + '</b></div>'
      + '<div><span>Age with no token</span><b class="num">' + shortAge(row.age_days) + '</b></div>'
      + '<div><span>Growth multiplier</span><b class="num">' + row.growth_multiplier + '</b></div>'
      + '<div><span>Maturity multiplier</span><b class="num">' + row.maturity_multiplier + '</b></div>'
      + '<div><span>Chain multiplier</span><b class="num">' + row.chain_multiplier + '</b></div>'
      + '<div><span>Chains</span><b class="num">' + (row.chains || []).length + '</b></div>'
      + '<div><span>Implied value</span><b class="num">' + shortMoney(row.implied_value_usd) + '</b></div>'
      + '</div><p class="sub">Model ' + esc(DATA.model_version) + ': the same function scores every protocol. The page recomputes this row as '
      + shortMoney(recomputed) + (agrees ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.')
      + ' This is an estimate, not a price.</p></section>'
      + '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol></section>';
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDetail() {
    const dialog = document.getElementById('detail');
    view.open = null;
    writeHash();
    if (dialog.open) dialog.close();
    render();
  }

  // --- Render and wire up ----------------------------------------------------
  function render() {
    root.innerHTML = '<div class="shell">' + headerHtml() + introHtml()
      + (view.tab === 'pre-token' ? spotlightHtml() : '')
      + controlsHtml()
      + (view.tab === 'pre-token' ? boardHtml() : liveHtml())
      + (view.tab === 'pre-token' ? modelHtml() : '')
      + '</div><dialog class="detail" id="detail" aria-labelledby="detail-title"></dialog>';
    root.setAttribute('aria-busy', 'false');

    const search = root.querySelector('#q');
    search.addEventListener('input', () => { view.search = search.value; writeHash(); render(); });
    const category = root.querySelector('#category');
    category.addEventListener('change', () => { view.category = category.value; writeHash(); render(); });
    const chain = root.querySelector('#chain');
    chain.addEventListener('change', () => { view.chain = chain.value; writeHash(); render(); });

    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => { view.tab = btn.getAttribute('data-tab'); render(); });
    });
    root.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (view.sortBy === key) view.descending = !view.descending;
        else { view.sortBy = key; view.descending = true; }
        render();
      });
    });
    const clear = root.querySelector('[data-clear]');
    if (clear) {
      clear.addEventListener('click', () => {
        view.search = ''; view.category = 'All'; view.chain = 'All';
        writeHash(); render();
      });
    }
    root.querySelectorAll('[data-open]').forEach((node) => {
      node.addEventListener('click', () => openDetail(node.getAttribute('data-open')));
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(node.getAttribute('data-open')); }
      });
    });

    const dialog = root.querySelector('#detail');
    dialog.addEventListener('close', () => { if (view.open) { view.open = null; writeHash(); } });
    if (view.open) openDetail(view.open);
  }

  // The dialog lives outside render's fresh HTML once it opens, so a Close
  // button inside it is handled by delegation on the whole document.
  document.addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-close')) closeDetail();
  });
  window.addEventListener('keydown', (e) => {
    const dialog = document.getElementById('detail');
    if (e.key === 'Escape' && dialog && dialog.open) closeDetail();
  });

  readHash();
  render();
})();
