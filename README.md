# InventoryHub

A full-stack inventory management app: an **Express (Node.js) REST API** and a **vanilla JavaScript front-end** that talk to each other through a consistent JSON structure. The project combines the work from four activities done with **Microsoft Copilot**: generating the integration code, debugging integration issues, designing the JSON, and optimizing performance.

## Features

- List inventory with **search, category filter, sorting and pagination**
- **Add, edit and delete** items with server-side validation and per-field error messages
- Dashboard statistics (items, units in stock, inventory value, low-stock count)
- Consistent JSON responses and JSON-only error handling
- Automated API tests (`npm test`)

## Run it

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. Run the tests with `npm test`.

## Project structure

```
InventoryHub/
├── server.js            # Express API + validation + error handling
├── public/
│   ├── index.html       # page layout
│   ├── app.js           # front-end logic (api() wrapper, state, rendering)
│   └── style.css
├── test/api.test.js     # 9 automated API tests
└── package.json
```

## JSON structure

Every response uses the same envelope, so the front-end handles all results in one place.

Success (list, with paging metadata):

```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Wireless Mouse", "sku": "ELC-001", "quantity": 42,
      "price": 15.99, "category": "Electronics", "updatedAt": "2026-11-23T14:00:00.000Z" }
  ],
  "meta": { "page": 1, "limit": 5, "total": 10, "totalPages": 2 },
  "error": null
}
```

Error (validation failed, HTTP 422):

```json
{
  "success": false,
  "data": null,
  "meta": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": [
      { "field": "name", "message": "Name must be 2-80 characters." },
      { "field": "sku", "message": "SKU already exists." }
    ]
  }
}
```

| Method | Endpoint | Description | Success |
|---|---|---|---|
| GET | `/api/items?search=&category=&sort=&order=&page=&limit=` | List with search, filter, sort and paging | 200 |
| GET | `/api/items/:id` | One item | 200 |
| POST | `/api/items` | Create | 201 + `Location` header |
| PUT | `/api/items/:id` | Update | 200 |
| DELETE | `/api/items/:id` | Delete | 200 |
| GET | `/api/categories` | Distinct categories | 200 |
| GET | `/api/stats` | Dashboard numbers | 200 |
| GET | `/api/health` | Health check | 200 |

Error codes: `BAD_QUERY` and `BAD_ID` (400), `INVALID_JSON` (400), `NOT_FOUND` (404), `VALIDATION_ERROR` (422), `PAYLOAD_TOO_LARGE` (413), `SERVER_ERROR` (500).

## Integration issues found and how they were fixed

| Issue | Cause | Fix |
|---|---|---|
| Browser blocked API calls from another origin | No CORS headers | Enabled the `cors` middleware; the front-end also uses relative URLs (`/api`) so it works on any host and port |
| `Unexpected token <` in the console | The server returned an HTML error page and the client called `res.json()` blindly | The API always returns JSON (even for 404 and 500); the client checks the `Content-Type` header and the `success` flag before using the data |
| Quantity and price rejected or stored as text | HTML forms send numbers as strings | The server converts with `Number()` and validates the result |
| `GET /api/items/3` found nothing | Route params are strings, item IDs are numbers | One `parseId()` helper converts and rejects invalid IDs with a clear 400 |
| Invalid request body crashed the request | Malformed JSON | Error middleware turns parse errors into a `400 INVALID_JSON` response |
| Items saved twice | Double click on Save | The Save button is disabled while the request is running |
| Old search results overwrote new ones | Slow earlier request finished last | Each list request uses an `AbortController`; the previous one is cancelled |
| Server validation errors were hidden | Only a generic message was shown | The `details` array maps each message to its form field |
| New categories missing from the filter | Categories were loaded only once on page load | Categories are reloaded after every change (found while testing the UI) |
| Success message disappeared instantly | The table reload cleared every message | Reload clears only error messages (found while testing the UI) |

## Performance optimizations

- **Pagination and server-side filtering**: the client never downloads the whole inventory (`limit` is capped at 50).
- **Debounced search**: typing triggers one request after 300 ms of silence instead of one per keystroke (verified in the UI test: 1 request).
- **Client-side cache**: each query result is cached in a `Map` and cleared after any create, update or delete, so going back to a page is instant but never stale.
- **Request cancellation**: outdated list requests are aborted.
- **HTTP caching**: `ETag` with `Cache-Control: no-cache` lets the browser revalidate and receive a tiny `304 Not Modified` instead of the full body (covered by a test); static files are cached for one hour.
- **Compression**: responses are gzip-compressed.
- **Parallel loading**: the item list and the statistics are fetched at the same time with `Promise.all`.
- **Safe rendering**: user text is inserted with `textContent`, which is both faster than re-parsing HTML and prevents XSS (verified with an item named `<b>Item</b>`).

## Reflective summary: how Microsoft Copilot assisted

**Activity 1 - Generating and refining the integration code.** Copilot helped me create the Express routes and the front-end code that calls them. It suggested putting every network call in one `api()` function with `fetch`, `async/await` and `try/catch`, instead of repeating `fetch` calls in every handler, which made the integration much easier to refine and debug later.

**Activity 2 - Debugging and fixing integration issues.** Copilot helped me read console and network errors and trace each one to its cause: missing CORS headers, an HTML error page being parsed as JSON, numbers arriving as strings, and route parameters being strings instead of numbers. For each problem it proposed a fix, and I checked it by running the app and the tests. The issue table above lists every problem and its solution.

**Activity 3 - Creating and managing JSON.** Copilot helped me design one response envelope (`success`, `data`, `meta`, `error`) with meaningful HTTP status codes and field-level validation errors. Because the structure never changes, the front-end can show messages next to the right form field and handle paging from `meta`.

**Activity 4 - Optimizing the integration for performance.** Copilot suggested pagination, debounced search, a client-side cache with invalidation, request cancellation, ETag revalidation and gzip compression. I measured and tested these changes rather than assuming they worked, for example by confirming that one search produces a single request and that a repeated request returns `304`.

**What I learned.** Copilot was most useful when I gave it a specific error message or a precise goal, and I always verified its suggestions with automated tests and manual UI checks. Testing also found problems that nobody had asked about (the stale category list and the vanishing success message), which shows that generated code still needs careful review.
