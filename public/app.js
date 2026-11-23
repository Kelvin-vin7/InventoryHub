/* InventoryHub - front-end. Talks to the back-end only through api(). */
'use strict';

const API = '/api'; // same origin, so no CORS problems; works on any host/port

// ---------- 1. One place that talks to the server ----------
class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status; this.code = code; this.details = details || [];
  }
}

async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;            // cancelled on purpose
    throw new ApiError('Cannot reach the server. Is it running?', 0, 'NETWORK');
  }

  // Never call res.json() blindly: an HTML error page would throw "Unexpected token <".
  let payload = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    try { payload = await res.json(); } catch { /* handled below */ }
  }
  if (!payload) throw new ApiError(`Unexpected server response (HTTP ${res.status}).`, res.status, 'BAD_RESPONSE');
  if (!payload.success) {
    const e = payload.error || {};
    throw new ApiError(e.message || 'Request failed.', res.status, e.code, e.details);
  }
  return payload; // { success, data, meta, error }
}

// ---------- 2. State, cache, helpers ----------
const state = { page: 1, limit: 5, search: '', category: '', sort: 'name', order: 'asc', totalPages: 1 };
const cache = new Map();           // query string -> response; cleared after every change
let listController = null;         // lets us cancel an outdated list request
let editingId = null;

const $ = id => document.getElementById(id);
const money = n => '$' + Number(n).toFixed(2);

function showMessage(text, type = 'error') {
  const box = $('message');
  box.textContent = text;
  box.className = 'message ' + type;
  box.hidden = !text;
  if (text && type === 'success') setTimeout(() => { box.hidden = true; }, 2500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- 3. Loading and rendering ----------
async function loadItems() {
  const qs = new URLSearchParams({
    page: state.page, limit: state.limit, search: state.search,
    category: state.category, sort: state.sort, order: state.order,
  }).toString();

  if (listController) listController.abort();   // ignore the previous, now-stale request
  listController = new AbortController();

  try {
    let payload = cache.get(qs);
    if (!payload) {
      payload = await api('/items?' + qs, { signal: listController.signal });
      cache.set(qs, payload);
    }
    state.totalPages = payload.meta.totalPages;
    if (state.page > state.totalPages) { state.page = state.totalPages; return loadItems(); }
    renderRows(payload.data);
    $('pageInfo').textContent = `Page ${payload.meta.page} of ${payload.meta.totalPages} (${payload.meta.total} items)`;
    $('prev').disabled = payload.meta.page <= 1;
    $('next').disabled = payload.meta.page >= payload.meta.totalPages;
    if ($('message').classList.contains('error')) showMessage('');   // clear old errors only, keep success notes
  } catch (err) {
    if (err.name === 'AbortError') return;
    showMessage(err.message);
  }
}

function renderRows(items) {
  const tbody = $('rows');
  tbody.replaceChildren();                      // textContent only: user text is never parsed as HTML
  $('empty').hidden = items.length > 0;
  for (const item of items) {
    const tr = document.createElement('tr');
    const cells = [item.name, item.sku, item.category, item.quantity, money(item.price)];
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (i >= 3) td.className = 'num';
      if (i === 3 && item.quantity <= 5) td.classList.add('low');
      tr.appendChild(td);
    });
    const actions = document.createElement('td');
    actions.className = 'row-actions';
    const edit = document.createElement('button');
    edit.className = 'btn small'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => openDialog(item));
    const del = document.createElement('button');
    del.className = 'btn small danger'; del.textContent = 'Delete';
    del.addEventListener('click', () => removeItem(item));
    actions.append(edit, del);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function loadStats() {
  try {
    const { data } = await api('/stats');
    const box = $('stats');
    box.replaceChildren();
    [['Items', data.totalItems], ['Units in stock', data.totalUnits],
     ['Inventory value', money(data.totalValue)], ['Low stock', data.lowStock]].forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'stat';
      const v = document.createElement('strong'); v.textContent = value;
      const l = document.createElement('span'); l.textContent = label;
      card.append(v, l);
      box.appendChild(card);
    });
  } catch (err) { showMessage(err.message); }
}

async function loadCategories() {
  try {
    const { data } = await api('/categories');
    const select = $('category');
    select.replaceChildren(new Option('All categories', ''));   // rebuild so new categories appear
    for (const c of data) select.appendChild(new Option(c, c));
    if (!data.includes(state.category)) state.category = '';    // selected category no longer exists
    select.value = state.category;
  } catch (err) { showMessage(err.message); }
}

async function refreshAll() {
  cache.clear();                                // data changed: cached pages are no longer valid
  await loadCategories();                       // must finish first: it may reset the category filter
  await Promise.all([loadItems(), loadStats()]);
}

// ---------- 4. Create / update / delete ----------
function clearErrors() {
  document.querySelectorAll('.err').forEach(e => { e.textContent = ''; });
}

function openDialog(item = null) {
  editingId = item ? item.id : null;
  $('dialogTitle').textContent = item ? 'Edit item' : 'Add item';
  clearErrors();
  const f = $('form');
  f.name.value = item ? item.name : '';
  f.sku.value = item ? item.sku : '';
  f.category.value = item ? item.category : '';
  f.quantity.value = item ? item.quantity : 0;
  f.price.value = item ? item.price : 0;
  $('dialog').showModal();
}

async function saveItem(e) {
  e.preventDefault();
  clearErrors();
  const f = $('form');
  const body = {
    name: f.name.value, sku: f.sku.value, category: f.category.value,
    quantity: f.quantity.value, price: f.price.value,
  };
  $('saveBtn').disabled = true;                 // prevents double submit
  try {
    await api(editingId ? `/items/${editingId}` : '/items', { method: editingId ? 'PUT' : 'POST', body });
    $('dialog').close();
    showMessage(editingId ? 'Item updated.' : 'Item added.', 'success');
    await refreshAll();
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {       // show each server message next to its field
      err.details.forEach(d => {
        const el = document.querySelector(`.err[data-for="${d.field}"]`);
        if (el) el.textContent = d.message;
      });
    } else {
      showMessage(err.message);
      $('dialog').close();
    }
  } finally {
    $('saveBtn').disabled = false;
  }
}

async function removeItem(item) {
  if (!window.confirm(`Delete "${item.name}"?`)) return;
  try {
    await api(`/items/${item.id}`, { method: 'DELETE' });
    showMessage('Item deleted.', 'success');
    await refreshAll();
  } catch (err) {
    showMessage(err.message);
    if (err.status === 404) refreshAll();       // already gone: just resync the list
  }
}

// ---------- 5. Wire up the page ----------
function init() {
  $('search').addEventListener('input', debounce(e => {   // wait 300 ms: one request, not one per keystroke
    state.search = e.target.value.trim(); state.page = 1; loadItems();
  }, 300));
  [['category', 'category'], ['sort', 'sort'], ['order', 'order']].forEach(([id, key]) =>
    $(id).addEventListener('change', e => { state[key] = e.target.value; state.page = 1; loadItems(); }));
  $('prev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadItems(); } });
  $('next').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; loadItems(); } });
  $('addBtn').addEventListener('click', () => openDialog());
  $('cancelBtn').addEventListener('click', () => $('dialog').close());
  $('form').addEventListener('submit', saveItem);

  refreshAll();
}

document.addEventListener('DOMContentLoaded', init);
