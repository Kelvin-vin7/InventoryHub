/**
 * InventoryHub - back-end (Express)
 *
 * Every API response uses ONE JSON envelope so the front-end can handle
 * success and errors in a single, predictable way:
 *
 *   success: { "success": true,  "data": <payload>, "meta": <paging|null>, "error": null }
 *   error:   { "success": false, "data": null, "meta": null,
 *              "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
 */
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const app = express();

// ---------- Middleware ----------
app.use(cors());                          // lets a front-end on another origin call the API
app.use(compression());                   // gzip responses (performance)
app.use(express.json({ limit: '10kb' })); // parse JSON bodies, reject huge payloads
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' })); // cache static files

// ---------- In-memory data ----------
let nextId = 11;
const items = [
  ['Wireless Mouse', 'ELC-001', 42, 15.99, 'Electronics'],
  ['Mechanical Keyboard', 'ELC-002', 18, 59.9, 'Electronics'],
  ['USB-C Cable 1m', 'ELC-003', 120, 4.5, 'Electronics'],
  ['Notebook A5', 'STA-001', 200, 1.25, 'Stationery'],
  ['Ballpoint Pen (Blue)', 'STA-002', 350, 0.5, 'Stationery'],
  ['Desk Lamp', 'FUR-001', 12, 24.0, 'Furniture'],
  ['Office Chair', 'FUR-002', 4, 89.0, 'Furniture'],
  ['Whiteboard Marker', 'STA-003', 3, 1.8, 'Stationery'],
  ['Monitor Stand', 'FUR-003', 25, 19.5, 'Furniture'],
  ['Laptop Sleeve 14"', 'ACC-001', 8, 12.0, 'Accessories'],
].map(([name, sku, quantity, price, category], i) => ({
  id: i + 1, name, sku, quantity, price, category,
  updatedAt: new Date().toISOString(),
}));

const LOW_STOCK_LIMIT = 5;

// ---------- Response helpers (the JSON envelope) ----------
const ok = (res, data, meta = null, status = 200) =>
  res.status(status).json({ success: true, data, meta, error: null });

const fail = (res, status, code, message, details = []) =>
  res.status(status).json({ success: false, data: null, meta: null, error: { code, message, details } });

// ---------- Validation ----------
function validate(body, current = null) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const value = {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 2 || name.length > 80) errors.push({ field: 'name', message: 'Name must be 2-80 characters.' });
  value.name = name;

  const sku = typeof b.sku === 'string' ? b.sku.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{2,20}$/.test(sku)) errors.push({ field: 'sku', message: 'SKU must be 2-20 letters, digits or dashes.' });
  else if (items.some(i => i.sku === sku && (!current || i.id !== current.id)))
    errors.push({ field: 'sku', message: 'SKU already exists.' });
  value.sku = sku;

  // Numbers may arrive as strings from HTML forms - convert, then check.
  const quantity = Number(b.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000)
    errors.push({ field: 'quantity', message: 'Quantity must be a whole number from 0 to 1,000,000.' });
  value.quantity = quantity;

  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000000)
    errors.push({ field: 'price', message: 'Price must be a number from 0 to 1,000,000.' });
  value.price = Math.round(price * 100) / 100;

  const category = typeof b.category === 'string' ? b.category.trim() : '';
  if (category.length > 40) errors.push({ field: 'category', message: 'Category is at most 40 characters.' });
  value.category = category || 'Uncategorized';

  return { errors, value };
}

// Route params are strings; convert once and reject anything that is not a positive integer.
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------- Routes ----------
app.get('/api/health', (req, res) => ok(res, { status: 'up', time: new Date().toISOString() }));

// List with search, filter, sort and pagination (so the client never downloads everything)
app.get('/api/items', (req, res) => {
  const { search = '', category = '', sort = 'name', order = 'asc' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));

  const allowedSort = ['name', 'sku', 'quantity', 'price', 'category', 'updatedAt'];
  if (!allowedSort.includes(sort))
    return fail(res, 400, 'BAD_QUERY', `sort must be one of: ${allowedSort.join(', ')}`);
  if (!['asc', 'desc'].includes(order))
    return fail(res, 400, 'BAD_QUERY', 'order must be "asc" or "desc"');

  const q = String(search).trim().toLowerCase();
  let result = items.filter(i =>
    (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) &&
    (!category || i.category === category));

  const dir = order === 'desc' ? -1 : 1;
  result.sort((a, b) => {
    const x = a[sort], y = b[sort];
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });

  const total = result.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  res.set('Cache-Control', 'no-cache'); // browser must revalidate; ETag makes that a cheap 304
  ok(res, result.slice(start, start + limit), { page, limit, total, totalPages });
});

app.get('/api/categories', (req, res) =>
  ok(res, [...new Set(items.map(i => i.category))].sort()));

app.get('/api/stats', (req, res) => {
  ok(res, {
    totalItems: items.length,
    totalUnits: items.reduce((s, i) => s + i.quantity, 0),
    totalValue: Math.round(items.reduce((s, i) => s + i.quantity * i.price, 0) * 100) / 100,
    lowStock: items.filter(i => i.quantity <= LOW_STOCK_LIMIT).length,
  });
});

app.get('/api/items/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'BAD_ID', 'ID must be a positive integer.');
  const item = items.find(i => i.id === id);
  if (!item) return fail(res, 404, 'NOT_FOUND', `Item ${id} was not found.`);
  ok(res, item);
});

app.post('/api/items', (req, res) => {
  const { errors, value } = validate(req.body);
  if (errors.length) return fail(res, 422, 'VALIDATION_ERROR', 'Some fields are invalid.', errors);
  const item = { id: nextId++, ...value, updatedAt: new Date().toISOString() };
  items.push(item);
  res.set('Location', `/api/items/${item.id}`);
  ok(res, item, null, 201);
});

app.put('/api/items/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'BAD_ID', 'ID must be a positive integer.');
  const item = items.find(i => i.id === id);
  if (!item) return fail(res, 404, 'NOT_FOUND', `Item ${id} was not found.`);
  const { errors, value } = validate(req.body, item);
  if (errors.length) return fail(res, 422, 'VALIDATION_ERROR', 'Some fields are invalid.', errors);
  Object.assign(item, value, { updatedAt: new Date().toISOString() });
  ok(res, item);
});

app.delete('/api/items/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'BAD_ID', 'ID must be a positive integer.');
  const index = items.findIndex(i => i.id === id);
  if (index === -1) return fail(res, 404, 'NOT_FOUND', `Item ${id} was not found.`);
  items.splice(index, 1);
  ok(res, { id });
});

// ---------- Error handling (always JSON, never an HTML error page) ----------
app.use('/api', (req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));

app.use((err, req, res, next) => {            // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed')
    return fail(res, 400, 'INVALID_JSON', 'Request body is not valid JSON.');
  if (err.type === 'entity.too.large')
    return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  console.error(err);
  fail(res, 500, 'SERVER_ERROR', 'Something went wrong on the server.');
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`InventoryHub running at http://localhost:${PORT}`));
}
