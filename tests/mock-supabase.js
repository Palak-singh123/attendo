'use strict';
// In-memory PostgREST look-alike used by the offline tests.
const http = require('http');

const tables = {
  teachers: { rows: [], pk: 'teacher_id', next: 1 },
  students: { rows: [], pk: 'student_id', next: 1 },
  subjects: { rows: [], pk: 'subject_id', next: 1 },
  subject_students: { rows: [], pk: null, next: 1 },
  attendance_logs: { rows: [], pk: null, next: 1 },
};

function applyFilter(rows, key, expr) {
  if (['select', 'order', 'limit', 'offset'].includes(key)) return rows;
  if (expr.startsWith('eq.')) {
    const v = expr.slice(3);
    return rows.filter((r) => String(r[key]) === v);
  }
  if (expr.startsWith('in.(')) {
    const set = new Set(expr.slice(4, -1).split(','));
    return rows.filter((r) => set.has(String(r[key])));
  }
  if (expr === 'not.is.null') return rows.filter((r) => r[key] != null);
  throw new Error('mock: unsupported filter ' + key + '=' + expr);
}

function server() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (!m || !tables[m[1]]) return send(404, { message: 'no table' });
      const t = tables[m[1]];
      const params = [...url.searchParams.entries()];

      // column-existence check like PostgREST
      const sel = url.searchParams.get('select');
      if (sel && sel.includes('face_descriptor') && global.__noFaceColumn)
        return send(400, { code: '42703', message: 'column students.face_descriptor does not exist' });

      let rows = t.rows;
      for (const [k, v] of params) rows = applyFilter(rows, k, v);

      if (req.method === 'GET') {
        const order = url.searchParams.get('order');
        if (order) {
          const cols = order.split(',').map((o) => o.split('.')[0]);
          rows = [...rows].sort((a, b) => {
            for (const c of cols) {
              if (a[c] < b[c]) return -1;
              if (a[c] > b[c]) return 1;
            }
            return 0;
          });
        }
        const off = Number(url.searchParams.get('offset') || 0);
        const lim = Number(url.searchParams.get('limit') || 1000);
        rows = rows.slice(off, off + Math.min(lim, 1000));
        return send(200, JSON.parse(JSON.stringify(rows)));
      }
      if (req.method === 'POST') {
        const inc = JSON.parse(body);
        const made = inc.map((r) => {
          const row = { ...r };
          if (t.pk) row[t.pk] = t.next++;
          t.rows.push(row);
          return row;
        });
        return send(201, made);
      }
      if (req.method === 'PATCH') {
        const patch = JSON.parse(body);
        rows.forEach((r) => Object.assign(r, patch));
        return send(200, rows);
      }
      if (req.method === 'DELETE') {
        const del = new Set(rows);
        t.rows = t.rows.filter((r) => !del.has(r));
        return send(200, [...del]);
      }
      send(405, {});
    });
  });
}


module.exports = { tables, server };
