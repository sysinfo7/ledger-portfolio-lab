import { UNIVERSE, createPortfolio, trade, generateHistory, advanceDay, getView, validatePortfolio } from './engine.js';

const STORE_KEY = 'ledger.public-demo.portfolios.v1';
const $ = (id) => document.getElementById(id);
const symbols = Array.isArray(UNIVERSE) ? UNIVERSE : [];
let accounts = [];
let activeId = '';
let selectedSymbol = 'AAPL';
let selectedRange = 365;
let orderSide = 'buy';
let pendingOrder = null;
let playing = false;
let playTimer = null;
let storageAvailable = true;
let toastTimer;

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
const signedMoney = (value) => `${Number(value) >= 0 ? '+' : '−'}${money(Math.abs(Number(value) || 0))}`;
const pct = (value) => `${Number(value) >= 0 ? '+' : ''}${(Number(value) || 0).toFixed(2)}%`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const current = () => accounts.find((account) => account.id === activeId) || accounts[0];
const view = () => current() ? getView(current(), selectedSymbol) : null;
const asset = (symbol) => symbols.find((item) => item.symbol === symbol) || { symbol, name: symbol, sector: 'Other' };

function loadAccounts() {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) accounts = parsed.filter((item) => item && validatePortfolio(item));
    }
  } catch {
    storageAvailable = false;
  }
  if (!accounts.length) accounts = [createPortfolio('My Portfolio', 100000, 2026, 365)];
  activeId = accounts[0].id;
  if (accounts.length && !storageAvailable) showStorageWarning('Browser storage is unavailable. Your demo account will last only until you close this tab.');
  persist();
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(accounts));
    if (storageAvailable) {
      $('storageNotice').hidden = true;
      $('persistenceText').textContent = 'Saved on this device · no sign-in';
    }
  } catch {
    storageAvailable = false;
    showStorageWarning('Could not save this demo to browser storage. Your current work may be lost when you close this tab.');
  }
}

function showStorageWarning(message) {
  const el = $('storageNotice');
  el.textContent = message;
  el.hidden = false;
  $('persistenceText').textContent = 'Session only · storage unavailable';
}

function dateLabel(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? String(date || '—') : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function render() {
  const portfolio = current();
  if (!portfolio) return;
  const data = getView(portfolio, selectedSymbol);
  $('crumbName').textContent = portfolio.name;
  $('accountSelect').replaceChildren(...accounts.map((account) => {
    const option = document.createElement('option'); option.value = account.id; option.textContent = account.name; option.selected = account.id === portfolio.id; return option;
  }));
  $('scenarioDate').textContent = dateLabel(portfolio.scenarioDate);
  const elapsed = (Date.parse(`${portfolio.scenarioDate}T00:00:00Z`) - Date.parse(`${portfolio.startDate}T00:00:00Z`)) / 86400000;
  const canAdvance = elapsed < 1825;
  $('advanceBtn').disabled = !canAdvance;
  $('playBtn').disabled = !canAdvance;
  document.querySelector('.date-sub').textContent = canAdvance ? 'A virtual market timeline for this demo account' : 'Five-year scenario complete. Generate a shorter scenario to keep playing.';
  $('totalValue').textContent = money(data.summary.totalValue);
  $('totalReturn').textContent = `${pct(data.summary.totalGainPercent)}`;
  $('totalReturn').classList.toggle('negative', data.summary.totalGain < 0);
  $('returnChange').textContent = `${signedMoney(data.summary.totalGain)} since start`;
  $('returnChange').classList.toggle('negative', data.summary.totalGain < 0);
  $('investedValue').textContent = money(data.summary.initialInvestment);
  $('cashValue').textContent = money(data.summary.cash);
  const relativeValue = data.summary.initialInvestment > 0 ? Math.max(0, Math.min(100, data.summary.totalValue / data.summary.initialInvestment * 100)) : 0;
  $('investedBar').style.width = `${relativeValue}%`;
  $('startingCapitalLegend').textContent = `Starting capital ${money(data.summary.initialInvestment)}`;
  renderWatchlist(data);
  renderSelects();
  renderHoldings(data);
  renderActivity(data.trades);
  renderSuggestions(data.suggestions);
  renderPortfolioChart(data.history, data.summary.initialInvestment);
  renderStockChart(data.candles, data.quotes.find((quote) => quote.symbol === selectedSymbol));
  updateOrderEstimate();
}

function renderWatchlist(data) {
  const container = $('watchlist');
  container.replaceChildren(...data.quotes.map((quote) => {
    const button = document.createElement('button');
    button.className = `watch-item${quote.symbol === selectedSymbol ? ' chosen' : ''}`;
    button.type = 'button'; button.setAttribute('aria-label', `${quote.name} (${quote.symbol}), ${money(quote.price)}, ${pct(quote.changePercent)}. Show chart.`);
    const left = document.createElement('span'); left.className = 'watch-left';
    const mark = document.createElement('span'); mark.className = `ticker-mark ticker-${quote.symbol.slice(0, 1).toLowerCase()}`; mark.textContent = quote.symbol.slice(0, 1);
    const labels = document.createElement('span'); labels.className = 'watch-labels';
    const sym = document.createElement('strong'); sym.textContent = quote.symbol;
    const name = document.createElement('small'); name.textContent = quote.name;
    labels.append(sym, name); left.append(mark, labels);
    const right = document.createElement('span'); right.className = 'watch-right';
    const price = document.createElement('strong'); price.textContent = money(quote.price);
    const change = document.createElement('small'); change.textContent = pct(quote.changePercent); change.className = quote.changePercent >= 0 ? 'positive' : 'negative';
    right.append(price, change); button.append(left, right);
    button.addEventListener('click', () => { selectedSymbol = quote.symbol; $('symbolSelect').value = selectedSymbol; render(); });
    return button;
  }));
}

function renderSelects() {
  const select = $('symbolSelect');
  const existing = select.value || selectedSymbol;
  select.replaceChildren(...symbols.map((item) => { const option = document.createElement('option'); option.value = item.symbol; option.textContent = `${item.symbol} · ${item.name}`; return option; }));
  selectedSymbol = symbols.some((item) => item.symbol === existing) ? existing : (symbols[0]?.symbol || 'AAPL');
  select.value = selectedSymbol;
}

function renderHoldings(data) {
  const body = $('holdingsBody');
  $('holdingCount').textContent = String(data.holdings.length);
  $('holdingsEmpty').hidden = data.holdings.length > 0;
  body.closest('table').hidden = data.holdings.length === 0;
  body.replaceChildren(...data.holdings.map((holding) => {
    const row = document.createElement('tr');
    const info = asset(holding.symbol);
    const cells = [
      `<div class="asset-cell"><span class="asset-mark">${escapeHtml(holding.symbol.slice(0, 1))}</span><span><strong>${escapeHtml(holding.symbol)}</strong><small>${escapeHtml(info.name)}</small></span></div>`,
      `${Number(holding.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}`,
      money(holding.averageCost), money(holding.price), money(holding.value), `<span class="${holding.gain >= 0 ? 'positive' : 'negative'}">${signedMoney(holding.gain)}</span>`
    ];
    cells.forEach((html, index) => { const td = document.createElement('td'); if (index === 0 || index === 5) td.innerHTML = html; else td.textContent = html; row.append(td); });
    return row;
  }));
}

function renderActivity(trades) {
  const list = $('activityList');
  $('activityEmpty').hidden = trades.length > 0;
  list.hidden = trades.length === 0;
  list.replaceChildren(...trades.slice(0, 8).map((item) => {
    const row = document.createElement('div'); row.className = 'activity-row';
    const icon = document.createElement('span'); icon.className = `activity-icon ${item.side === 'buy' ? 'buy' : 'sell'}`; icon.textContent = item.side === 'buy' ? '↗' : '↙';
    const desc = document.createElement('div'); desc.className = 'activity-desc';
    const title = document.createElement('strong'); title.textContent = `${item.side === 'buy' ? 'Bought' : 'Sold'} ${item.symbol}`;
    const sub = document.createElement('span'); sub.textContent = `${Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })} shares · ${dateLabel(item.date)}`;
    desc.append(title, sub);
    const amount = document.createElement('strong'); amount.className = 'activity-amount'; amount.textContent = `${item.side === 'buy' ? '−' : '+'}${money(Number(item.price) * Number(item.quantity))}`;
    row.append(icon, desc, amount); return row;
  }));
}

function renderSuggestions(suggestions) {
  const list = $('suggestionsList');
  list.replaceChildren(...suggestions.slice(0, 3).map((suggestion) => {
    const card = document.createElement('article'); card.className = 'suggestion-card';
    const head = document.createElement('div'); head.className = 'suggestion-head';
    const symbol = document.createElement('strong'); symbol.textContent = suggestion.symbol;
    const score = document.createElement('span'); score.className = `suggestion-score ${suggestion.score >= 0 ? 'positive' : 'negative'}`; score.textContent = pct(suggestion.score);
    head.append(symbol, score);
    const title = document.createElement('span'); title.className = 'suggestion-title'; title.textContent = suggestion.title;
    const reason = document.createElement('p'); reason.textContent = suggestion.reason;
    card.append(head, title, reason);
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `${suggestion.symbol}: ${suggestion.title}. ${suggestion.reason} Show chart.`);
    card.addEventListener('click', () => { selectedSymbol = suggestion.symbol; $('symbolSelect').value = selectedSymbol; render(); });
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); } });
    return card;
  }));
}

function nice(n) { if (!Number.isFinite(n) || n <= 0) return 1; const p = 10 ** Math.floor(Math.log10(n)); const x = n / p; return (x <= 1 ? 1 : x <= 2 ? 2 : x <= 5 ? 5 : 10) * p; }
function makeLineChart(container, values, baseline, { height = 188, prefix = 'portfolio' } = {}) {
  if (!values.length) { container.innerHTML = '<div class="chart-empty">Not enough history yet.</div>'; return; }
  const W = 720, H = height, left = 48, right = 8, top = 12, bottom = 28;
  const valid = values.map((point) => Number(point.value)).filter(Number.isFinite);
  const all = baseline == null ? valid : valid.concat([Number(baseline)]);
  let min = Math.min(...all), max = Math.max(...all); if (min === max) { min -= 1; max += 1; }
  const spread = max - min; min -= spread * .08; max += spread * .08;
  const plotW = W - left - right, plotH = H - top - bottom;
  const x = (i) => left + (values.length === 1 ? plotW / 2 : i * plotW / (values.length - 1));
  const y = (v) => top + (max - v) / (max - min) * plotH;
  const points = values.map((point, i) => `${x(i).toFixed(2)},${y(Number(point.value)).toFixed(2)}`).join(' ');
  const area = `${left},${H - bottom} ${points} ${left + plotW},${H - bottom}`;
  const steps = 4, grid = Array.from({ length: steps + 1 }, (_, i) => { const value = min + (max - min) * i / steps; const yy = y(value); return `<g><line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" class="grid-line"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end" class="axis-label">${money(value).replace('.00', '')}</text></g>`; }).join('');
  const baseLine = baseline == null ? '' : `<line x1="${left}" y1="${y(Number(baseline))}" x2="${W - right}" y2="${y(Number(baseline))}" class="baseline-line"/>`;
  const labels = [0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}" class="axis-label">${escapeHtml(String(values[i].label || values[i].date || '').slice(0, 10))}</text>`).join('');
  const description = values.length > 1 ? `Chart of ${prefix} from ${values[0].label || values[0].date} to ${values.at(-1).label || values.at(-1).date}. Last value ${money(valid.at(-1))}.` : `Chart with one value, ${money(valid[0])}.`;
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(description)}" preserveAspectRatio="none"><defs><linearGradient id="${prefix}Fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#33866c" stop-opacity=".22"/><stop offset="100%" stop-color="#33866c" stop-opacity="0"/></linearGradient></defs>${grid}${baseLine}<polygon points="${area}" fill="url(#${prefix}Fill)"/><polyline points="${points}" class="chart-line"/>${labels}<line class="crosshair" x1="0" y1="${top}" x2="0" y2="${H - bottom}"/><circle class="chart-point" cx="${x(values.length - 1)}" cy="${y(valid.at(-1))}" r="4"/></svg><div class="chart-tooltip" aria-hidden="true"></div>`;
  const svg = container.querySelector('svg'); const crosshair = svg.querySelector('.crosshair'); const tooltip = container.querySelector('.chart-tooltip');
  svg.addEventListener('pointermove', (event) => { const rect = svg.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * W; const index = Math.max(0, Math.min(values.length - 1, Math.round((px - left) / plotW * (values.length - 1)))); const xx = x(index); crosshair.setAttribute('x1', xx); crosshair.setAttribute('x2', xx); tooltip.textContent = `${values[index].label || values[index].date} · ${money(values[index].value)}`; tooltip.style.left = `${Math.max(0, Math.min(85, xx / W * 100))}%`; tooltip.classList.add('visible'); });
  svg.addEventListener('pointerleave', () => { tooltip.classList.remove('visible'); crosshair.setAttribute('x1', 0); crosshair.setAttribute('x2', 0); });
}

function renderPortfolioChart(history, baseline) {
  const filtered = history.slice(-selectedRange).map((point) => ({ ...point, value: Number(point.value), label: point.date }));
  const spark = history.slice(-40).map((point) => Number(point.value)).filter(Number.isFinite);
  if (spark.length > 1) {
    const min = Math.min(...spark), max = Math.max(...spark), range = max - min || 1;
    const points = spark.map((value, index) => `${(index * 119 / (spark.length - 1)).toFixed(1)},${(26 - (value - min) / range * 23).toFixed(1)}`).join(' ');
    document.querySelector('.metric-spark svg').innerHTML = `<polyline points="${points}"/>`;
  }
  const sampled = filtered.length > 90 ? filtered.filter((_, index) => index % Math.ceil(filtered.length / 90) === 0 || index === filtered.length - 1) : filtered;
  makeLineChart($('portfolioChart'), sampled, baseline, { prefix: 'portfolio' });
  $('chartEndDate').textContent = history.length ? dateLabel(history.at(-1).date) : '—';
  document.querySelectorAll('.range-tab').forEach((button) => { const active = Number(button.dataset.range) === selectedRange; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
}

function renderStockChart(candles, quote) {
  const sequence = candles.slice(-45).map((point) => ({ value: Number(point.close), date: point.date, label: point.date }));
  $('stockChartTitle').textContent = quote ? quote.symbol : selectedSymbol;
  $('stockChartSubtitle').textContent = quote ? asset(quote.symbol).name : 'Synthetic daily close';
  $('stockPrice').textContent = money(quote?.price);
  $('stockChange').textContent = pct(quote?.changePercent || 0);
  $('stockChange').className = `stock-change ${(quote?.changePercent || 0) >= 0 ? 'positive' : 'negative'}`;
  makeLineChart($('stockChart'), sequence, null, { height: 148, prefix: 'stock' });
}

function updateOrderEstimate() {
  const data = view(); const q = Number($('quantityInput').value);
  const quote = data?.quotes.find((item) => item.symbol === $('symbolSelect').value);
  $('orderEstimate').textContent = money((quote?.price || 0) * (Number.isFinite(q) ? q : 0));
  $('submitLabel').textContent = `Review ${orderSide} order`;
  $('orderNote').textContent = orderSide === 'buy' ? `Available cash: ${money(data?.summary.cash || 0)} · price estimate uses synthetic close.` : `Shares held: ${Number(data?.holdings.find((item) => item.symbol === $('symbolSelect').value)?.quantity || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} · price estimate uses synthetic close.`;
}

function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function toast(message) { const element = $('toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 2800); }
function saveCurrent(next) { accounts = accounts.map((item) => item.id === next.id ? next : item); persist(); render(); }
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function download(name, content, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportTrades() {
  const rows = [['date', 'side', 'symbol', 'quantity', 'price', 'request_id'], ...(view()?.trades || []).map((item) => [item.date, item.side, item.symbol, item.quantity, item.price, item.requestId])];
  download(`${current().name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-activity.csv`, rows.map((row) => row.map(csvEscape).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

loadAccounts();
render();

$('accountSelect').addEventListener('change', (event) => { activeId = event.target.value; render(); });
$('addAccountBtn').addEventListener('click', () => { stopPlay(); $('accountNameInput').value = ''; openDialog('accountDialog'); $('accountNameInput').focus(); });
$('accountDialogForm').addEventListener('submit', (event) => { if (event.submitter?.value !== 'create') return; event.preventDefault(); const name = $('accountNameInput').value.trim(); if (!name) return; const created = createPortfolio(name, 100000, 2026 + accounts.length, 365); accounts.push(created); activeId = created.id; persist(); $('accountDialog').close(); render(); toast('Demo account created.'); });
$('tradeForm').addEventListener('submit', (event) => {
  event.preventDefault(); const quantity = Number($('quantityInput').value); const symbol = $('symbolSelect').value;
  if (!(quantity > 0)) return;
  const quote = view()?.quotes.find((item) => item.symbol === symbol); if (!quote) return;
  pendingOrder = { symbol, side: orderSide, quantity, price: quote.price, requestId: `local-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}` };
  $('orderPreview').innerHTML = `<div><span>Action</span><strong class="${orderSide}">${orderSide === 'buy' ? 'Buy' : 'Sell'} ${escapeHtml(symbol)}</strong></div><div><span>Shares</span><strong>${quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}</strong></div><div><span>Estimated price</span><strong>${money(quote.price)} / share</strong></div><div class="order-total"><span>Estimated total</span><strong>${money(quote.price * quantity)}</strong></div>`;
  stopPlay(); openDialog('orderDialog');
});
$('orderDialogForm').addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'confirm') return; event.preventDefault(); if (!pendingOrder) return;
  try { saveCurrent(trade(current(), pendingOrder)); $('orderDialog').close(); $('quantityInput').value = ''; pendingOrder = null; updateOrderEstimate(); toast('Virtual order added to this demo account.'); }
  catch (error) { $('orderDialog').close(); toast(error instanceof Error ? error.message : 'Could not place this virtual order.'); }
});
document.querySelectorAll('.side-option').forEach((button) => button.addEventListener('click', () => { orderSide = button.dataset.side; document.querySelectorAll('.side-option').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); updateOrderEstimate(); }));
$('symbolSelect').addEventListener('change', (event) => { selectedSymbol = event.target.value; render(); });
$('quantityInput').addEventListener('input', updateOrderEstimate);
document.querySelectorAll('.range-tab').forEach((button) => button.addEventListener('click', () => { selectedRange = Number(button.dataset.range); render(); }));
$('advanceBtn').addEventListener('click', () => { stopPlay(); saveCurrent(advanceDay(current())); });
$('playBtn').addEventListener('click', () => {
  if ($('playBtn').disabled) return;
  if (playing) { stopPlay(); return; }
  playing = true; $('playBtn').innerHTML = '<span class="play-symbol">Ⅱ</span> Pause simulation'; $('playBtn').setAttribute('aria-pressed', 'true'); let steps = 0;
  playTimer = setInterval(() => { if (!document.querySelector('dialog[open]')) { saveCurrent(advanceDay(current())); steps += 1; if (steps >= 90) stopPlay(); } }, 2000);
});
function stopPlay() { if (playTimer) clearInterval(playTimer); playTimer = null; playing = false; $('playBtn').innerHTML = '<span class="play-symbol">▶</span> Play simulation'; $('playBtn').setAttribute('aria-pressed', 'false'); }
$('generatorOpen')?.addEventListener('click', () => { stopPlay(); $('generatorAccountName').textContent = current().name; $('generatorConfirm').checked = false; openDialog('generatorDialog'); });
$('aboutOpen').addEventListener('click', () => { stopPlay(); openDialog('aboutDialog'); });
$('aboutAvatar').addEventListener('click', () => { stopPlay(); openDialog('aboutDialog'); });
$('resetOpen').addEventListener('click', () => { $('aboutDialog').close(); openDialog('resetDialog'); });
$('walkthroughOpen').addEventListener('click', () => { location.href = '/employer-guide.html'; });
$('tradeJump').addEventListener('click', () => $('tradeSection').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('emptyTrade').addEventListener('click', () => $('tradeSection').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('holdingsNav').addEventListener('click', () => $('holdingsSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('activityNav').addEventListener('click', () => $('activitySection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('overviewNav').addEventListener('click', () => $('main').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('seeAllHoldings').addEventListener('click', () => $('holdingsSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('exportMenuBtn').addEventListener('click', () => { const data = { portfolio: current(), view: getView(current(), selectedSymbol) }; download(`${current().name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-demo.json`, JSON.stringify(data, null, 2), 'application/json'); });
$('exportActivity').addEventListener('click', exportTrades);
$('generatorForm').addEventListener('submit', (event) => { if (event.submitter?.value !== 'generate') return; event.preventDefault(); if (!$('generatorConfirm').checked) return; const seed = Number($('generatorSeed').value); const days = Number($('generatorDays').value); if (!(seed > 0)) return; try { saveCurrent(generateHistory(current(), days, seed)); stopPlay(); $('generatorDialog').close(); toast('Synthetic scenario regenerated for this account.'); } catch (error) { toast(error instanceof Error ? error.message : 'Could not generate this scenario.'); } });
$('resetForm').addEventListener('submit', (event) => { if (event.submitter?.value !== 'reset') return; event.preventDefault(); stopPlay(); try { localStorage.removeItem(STORE_KEY); storageAvailable = true; accounts = [createPortfolio('My Portfolio', 100000, 2026, 365)]; activeId = accounts[0].id; persist(); render(); $('resetDialog').close(); toast('Local demo accounts reset.'); } catch { showStorageWarning('The demo reset could not clear browser storage.'); } });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') pendingOrder = null; });
