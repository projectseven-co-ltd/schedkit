// src/lib/noco.js — NocoDB API client

const BASE = process.env.NOCO_URL;
const TOKEN = process.env.NOCO_TOKEN;
const BASE_ID = process.env.NOCO_BASE_ID;

const headers = {
  'xc-token': TOKEN,
  'Content-Type': 'application/json',
};

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`NocoDB ${method} ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

// Table helpers
export const meta = {
  createTable: (name, columns) =>
    req('POST', `/api/v1/db/meta/projects/${BASE_ID}/tables`, { title: name, columns }),
  getTables: () =>
    req('GET', `/api/v1/db/meta/projects/${BASE_ID}/tables`),
};

// Data helpers
export const db = {
  list: (tableId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/api/v1/db/data/noco/${BASE_ID}/${tableId}${qs ? '?' + qs : ''}`);
  },
  get: (tableId, rowId) =>
    req('GET', `/api/v1/db/data/noco/${BASE_ID}/${tableId}/${rowId}`),
  create: (tableId, data) =>
    req('POST', `/api/v1/db/data/noco/${BASE_ID}/${tableId}`, data),
  update: (tableId, rowId, data) =>
    req('PATCH', `/api/v1/db/data/noco/${BASE_ID}/${tableId}/${rowId}`, data),
  delete: (tableId, rowId) =>
    req('DELETE', `/api/v1/db/data/noco/${BASE_ID}/${tableId}/${rowId}`),
  find: (tableId, where) =>
    req('GET', `/api/v1/db/data/noco/${BASE_ID}/${tableId}?where=${encodeURIComponent(where)}`),
};
