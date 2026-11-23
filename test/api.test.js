const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let server, base;
test.before(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => server.close());

const json = async (path, opts) => {
  const res = await fetch(base + path, opts);
  return { res, body: await res.json() };
};
const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('every response uses the JSON envelope', async () => {
  const { res, body } = await json('/items');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['data', 'error', 'meta', 'success']);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  assert.deepEqual(Object.keys(body.meta).sort(), ['limit', 'page', 'total', 'totalPages']);
});

test('pagination, search, filter and sort', async () => {
  const p = await json('/items?page=2&limit=3');
  assert.equal(p.body.data.length, 3);
  assert.equal(p.body.meta.page, 2);
  const s = await json('/items?search=mouse');
  assert.equal(s.body.meta.total, 1);
  const c = await json('/items?category=Furniture&sort=price&order=desc');
  assert.ok(c.body.data.every(i => i.category === 'Furniture'));
  assert.ok(c.body.data[0].price >= c.body.data[1].price);
});

test('bad query returns 400 JSON error', async () => {
  const { res, body } = await json('/items?sort=hacker');
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'BAD_QUERY');
});

test('create (201) -> read -> update -> delete', async () => {
  const created = await json('/items', send('POST', { name: 'Test Item', sku: 'tst-1', quantity: '7', price: '9.5', category: 'Test' }));
  assert.equal(created.res.status, 201);
  assert.equal(created.body.data.sku, 'TST-1');          // normalised
  assert.equal(created.body.data.quantity, 7);           // string "7" converted to number
  const id = created.body.data.id;

  const read = await json(`/items/${id}`);
  assert.equal(read.body.data.name, 'Test Item');

  const upd = await json(`/items/${id}`, send('PUT', { name: 'Renamed', sku: 'TST-1', quantity: 9, price: 10, category: 'Test' }));
  assert.equal(upd.res.status, 200);
  assert.equal(upd.body.data.name, 'Renamed');

  const del = await json(`/items/${id}`, { method: 'DELETE' });
  assert.equal(del.body.data.id, id);
  const gone = await json(`/items/${id}`);
  assert.equal(gone.res.status, 404);
});

test('validation errors return 422 with field details', async () => {
  const { res, body } = await json('/items', send('POST', { name: 'x', sku: '!!', quantity: -1, price: 'abc' }));
  assert.equal(res.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  const fields = body.error.details.map(d => d.field).sort();
  assert.deepEqual(fields, ['name', 'price', 'quantity', 'sku']);
});

test('duplicate SKU is rejected', async () => {
  const { res, body } = await json('/items', send('POST', { name: 'Dup', sku: 'ELC-001', quantity: 1, price: 1 }));
  assert.equal(res.status, 422);
  assert.ok(body.error.details.some(d => d.field === 'sku' && /exists/.test(d.message)));
});

test('bad id, missing id, malformed JSON and unknown route all return JSON errors', async () => {
  assert.equal((await json('/items/abc')).res.status, 400);
  assert.equal((await json('/items/9999')).res.status, 404);
  const bad = await fetch(base + '/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_JSON');
  const nf = await json('/nothing-here');
  assert.equal(nf.res.status, 404);
  assert.equal(nf.body.success, false);
});

test('stats endpoint', async () => {
  const { body } = await json('/stats');
  assert.ok(body.data.totalItems > 0);
  assert.ok(body.data.lowStock >= 1);
});

test('performance: ETag lets the browser revalidate with a 304', async () => {
  const http = require('node:http');
  const get = headers => new Promise((resolve, reject) => {
    http.get(base + '/items', { headers }, res => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
  });
  const first = await get({});
  const etag = first.headers.etag;
  assert.ok(etag);
  const second = await get({ 'If-None-Match': etag });   // what a browser sends on revalidation
  assert.equal(second.statusCode, 304);
});
