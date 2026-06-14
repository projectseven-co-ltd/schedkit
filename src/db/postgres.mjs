import { getPool } from './pool.mjs';
import { assertTable, parseSort, parseWhere } from './where.mjs';

function toRow(row) {
  if (!row) return null;
  return { ...row, Id: row.id };
}

function sanitizeData(data) {
  const out = { ...data };
  delete out.Id;
  delete out.id;
  delete out.CreatedAt;
  delete out.UpdatedAt;
  return out;
}

async function queryRows(sql, params) {
  const { rows } = await getPool().query(sql, params);
  return rows.map(toRow);
}

async function queryOne(sql, params) {
  const rows = await queryRows(sql, params);
  return rows[0] || null;
}

async function queryCount(table, whereClause, params) {
  const sql = `SELECT COUNT(*)::int AS total FROM ${table} WHERE ${whereClause}`;
  const { rows } = await getPool().query(sql, params);
  return rows[0]?.total ?? 0;
}

function buildSelect(table, whereClause, params, { sort, limit, offset } = {}) {
  assertTable(table);
  let sql = `SELECT * FROM ${table} WHERE ${whereClause}`;
  const allParams = [...params];
  if (sort) sql += ` ORDER BY ${parseSort(sort)}`;
  if (limit != null) {
    allParams.push(Number(limit));
    sql += ` LIMIT $${allParams.length}`;
  }
  if (offset != null) {
    allParams.push(Number(offset));
    sql += ` OFFSET $${allParams.length}`;
  }
  return { sql, params: allParams };
}

export const db = {
  async list(table, params = {}) {
    assertTable(table);
    const { where, sort, limit, offset } = params;
    const parsed = parseWhere(where);
    const { sql, params: qParams } = buildSelect(table, parsed.clause, parsed.params, { sort, limit, offset });
    const list = await queryRows(sql, qParams);
    const total = await queryCount(table, parsed.clause, parsed.params);
    return { list, pageInfo: { totalRows: total } };
  },

  async get(table, rowId) {
    assertTable(table);
    return queryOne(`SELECT * FROM ${table} WHERE id = $1`, [rowId]);
  },

  async create(table, data) {
    assertTable(table);
    const row = sanitizeData(data);
    const keys = Object.keys(row);
    if (!keys.length) throw new Error('create requires data');
    const cols = keys.join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => row[k]);
    const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
    return queryOne(sql, values);
  },

  async update(table, rowId, data) {
    assertTable(table);
    const row = sanitizeData(data);
    const keys = Object.keys(row);
    if (!keys.length) return db.get(table, rowId);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map(k => row[k]);
    values.push(rowId);
    const sql = `UPDATE ${table} SET ${sets} WHERE id = $${values.length} RETURNING *`;
    return queryOne(sql, values);
  },

  async delete(table, rowId) {
    assertTable(table);
    await getPool().query(`DELETE FROM ${table} WHERE id = $1`, [rowId]);
  },

  async find(table, where, params = {}) {
    assertTable(table);
    const parsed = parseWhere(where);
    const { sql, params: qParams } = buildSelect(table, parsed.clause, parsed.params, params);
    const list = await queryRows(sql, qParams);
    const total = await queryCount(table, parsed.clause, parsed.params);
    return { list, pageInfo: { totalRows: total } };
  },
};

export { runMigrations } from './migrate.mjs';
export { closePool } from './pool.mjs';
