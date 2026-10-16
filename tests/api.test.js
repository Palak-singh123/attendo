'use strict';
/**
 * Offline API test: spins up a tiny in-memory PostgREST look-alike and
 * drives the real handlers through the real /api/rpc entry point.
 *   node tests/api.test.js
 */
const assert = require('assert');

const { tables, server } = require('./mock-supabase');

/* ----------------------------------------------------------- test helpers */
function descriptor(seed, noise = 0) {
  // deterministic pseudo "face": a point on a sphere of radius ~0.9 + tiny noise
  const d = [];
  let x = seed * 9301 + 49297;
  for (let i = 0; i < 128; i++) {
    x = (x * 9301 + 49297) % 233280;
    d.push(x / 233280 - 0.5);
  }
  const norm = Math.sqrt(d.reduce((s, v) => s + v * v, 0));
  return d.map((v, i) => (v / norm) * 0.9 + (noise ? Math.sin(i * 12.9898 + seed + noise) * noise : 0));
}

async function main() {
  const mock = server();
  await new Promise((r) => mock.listen(0, r));
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + mock.address().port;
  process.env.SUPABASE_SERVICE_KEY = 'test-key';
  process.env.SESSION_SECRET = 'test-secret';

  const rpc = require('../api/rpc.js');

  async function call(action, payload = {}, token) {
    const req = {
      method: 'POST',
      headers: { authorization: token ? 'Bearer ' + token : '', 'x-forwarded-for': '1.2.3.4' },
      body: { action, ...payload },
      socket: {},
      url: '/api/rpc',
    };
    const out = { status: 0, body: null };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(s) {
        out.status = this.statusCode;
        out.body = JSON.parse(s);
      },
    };
    await rpc(req, res);
    return out;
  }
  const ok = async (action, payload, token) => {
    const r = await call(action, payload, token);
    assert.strictEqual(r.status, 200, `${action} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const fails = async (action, payload, token, status) => {
    const r = await call(action, payload, token);
    assert.strictEqual(r.status, status, `${action} expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  // ---- health
  const health = await (async () => {
    const req = { method: 'GET', headers: {}, url: '/api/rpc?action=health', socket: {} };
    const out = {};
    await rpc(req, { setHeader() {}, end(s) { out.b = JSON.parse(s); } });
    return out.b;
  })();
  assert.strictEqual(health.ok, true);
  console.log('ok  health');

  // ---- teacher register + login
  await fails('teacher-register', { username: 'ab', name: 'X', password: '123456' }, null, 400);
  await ok('teacher-register', { username: 'Anaya.Roy', name: 'Ananya Roy', password: 'secret123' });
  await fails('teacher-register', { username: 'anaya.roy', name: 'Dup', password: 'secret123' }, null, 409);
  await fails('teacher-login', { username: 'anaya.roy', password: 'wrongpass' }, null, 401);
  const login = await ok('teacher-login', { username: 'Anaya.Roy', password: 'secret123' });
  assert.ok(login.token && login.user.name === 'Ananya Roy');
  const T = login.token;
  console.log('ok  teacher auth');

  // ---- auth guards
  await fails('teacher-subjects', {}, null, 401);
  await fails('teacher-subjects', {}, 'garbage.token', 401);
  console.log('ok  auth guards');

  // ---- subjects
  await fails('subject-create', { subject_code: 'c', name: 'x', section: 'A' }, T, 400);
  const sub = (await ok('subject-create', { subject_code: 'cs101', name: 'Intro CS', section: 'A' }, T)).subject;
  assert.strictEqual(sub.subject_code, 'CS101');
  await fails('subject-create', { subject_code: 'CS101', name: 'Other', section: 'B' }, T, 409);

  // ---- students register by face
  const A = descriptor(1), B = descriptor(2), C = descriptor(3);
  const regA = await ok('student-register', { name: 'Aarav', descriptors: [A, descriptor(1, 0.01)] });
  const regB = await ok('student-register', { name: 'Bhavna', descriptors: [B] });
  await ok('student-register', { name: 'Chirag', descriptors: [C] });
  await fails('student-register', { name: 'Aarav Again', descriptors: [descriptor(1, 0.02)] }, null, 409);
  await fails('student-register', { name: 'Mixed', descriptors: [descriptor(10), descriptor(11)] }, null, 400);
  console.log('ok  student register + duplicate-face guard');

  // ---- face login
  const lg = await ok('student-login', { descriptor: descriptor(1, 0.02) });
  assert.strictEqual(lg.matched, true);
  assert.strictEqual(lg.user.name, 'Aarav');
  const none = await ok('student-login', { descriptor: descriptor(99) });
  assert.strictEqual(none.matched, false);
  console.log('ok  student face login');
  const SA = regA.token, SB = regB.token;

  // ---- enrollment
  await fails('subject-lookup', { code: 'nope' }, SA, 404);
  const lk = await ok('subject-lookup', { code: 'cs101' }, SA);
  assert.strictEqual(lk.subject.name, 'Intro CS');
  assert.strictEqual(lk.enrolled, false);
  await ok('student-enroll', { code: 'cs101' }, SA);
  await ok('student-enroll', { code: 'CS101' }, SB);
  await fails('student-enroll', { code: 'CS101' }, SA, 409);
  await fails('subject-create', { subject_code: 'ZZ9', name: 'x', section: 'A' }, SA, 403); // student token
  console.log('ok  enrollment');

  // ---- attendance match (photo with A, B, and unknown stranger, + Chirag not enrolled)
  const m = await ok(
    'attendance-match',
    {
      subject_id: sub.subject_id,
      threshold: 0.5,
      photos: [{ descriptors: [descriptor(1, 0.02), descriptor(3, 0.02), descriptor(77)] }],
    },
    T
  );
  const byName = Object.fromEntries(m.roster.map((r) => [r.name, r]));
  assert.strictEqual(byName.Aarav.present, true);
  assert.strictEqual(byName.Bhavna.present, false);
  const statuses = m.photos[0].faces.map((f) => f.status).sort();
  assert.deepStrictEqual(statuses, ['matched', 'not_enrolled', 'unknown']);
  console.log('ok  attendance-match');

  // ---- save, duplicate, records
  const when = new Date(Date.now() - 3600_000).toISOString();
  const saved = await ok(
    'attendance-save',
    { subject_id: sub.subject_id, timestamp: when, entries: m.roster.map((r) => ({ student_id: r.student_id, is_present: r.present })) },
    T
  );
  assert.strictEqual(saved.saved, 2);
  await fails('attendance-save', { subject_id: sub.subject_id, timestamp: when, entries: [{ student_id: 1, is_present: true }] }, T, 409);
  await fails('attendance-save', { subject_id: sub.subject_id, timestamp: new Date(Date.now() + 86400000).toISOString(), entries: [{ student_id: 1, is_present: true }] }, T, 400);
  const second = new Date(Date.now() - 1800_000).toISOString();
  await ok('attendance-save', { subject_id: sub.subject_id, timestamp: second, entries: [{ student_id: regA.user.id, is_present: true }, { student_id: regB.user.id, is_present: true }] }, T);

  const recs = await ok('attendance-records', {}, T);
  assert.strictEqual(recs.sessions.length, 2);
  const roster = await ok('subject-roster', { subject_id: sub.subject_id }, T);
  const rA = roster.students.find((s) => s.name === 'Aarav');
  const rB = roster.students.find((s) => s.name === 'Bhavna');
  assert.strictEqual(rA.percent, 100);
  assert.strictEqual(rB.percent, 50);
  const mat = await ok('subject-matrix', { subject_id: sub.subject_id }, T);
  assert.strictEqual(mat.sessions.length, 2);
  console.log('ok  save / records / roster / matrix');

  // ---- session edit / delete
  const ses = recs.sessions[recs.sessions.length - 1]; // the older one
  const det = await ok('session-detail', { subject_id: sub.subject_id, timestamp: ses.timestamp }, T);
  assert.strictEqual(det.entries.length, 2);
  await ok('session-update', { subject_id: sub.subject_id, timestamp: ses.timestamp, entries: [{ student_id: regB.user.id, is_present: true }] }, T);
  const roster2 = await ok('subject-roster', { subject_id: sub.subject_id }, T);
  assert.strictEqual(roster2.students.find((s) => s.name === 'Bhavna').percent, 100);
  await ok('session-delete', { subject_id: sub.subject_id, timestamp: ses.timestamp }, T);
  assert.strictEqual((await ok('attendance-records', {}, T)).sessions.length, 1);
  console.log('ok  session edit/delete');

  // ---- student dashboard
  const dash = await ok('student-dashboard', {}, SA);
  assert.strictEqual(dash.subjects.length, 1);
  assert.strictEqual(dash.subjects[0].teacher, 'Ananya Roy');
  assert.strictEqual(dash.subjects[0].total, 1);
  assert.strictEqual(dash.student.faceSamples, 2);
  await ok('student-add-face', { descriptors: [descriptor(1, 0.015)] }, SA);
  await fails('student-add-face', { descriptors: [descriptor(50)] }, SA, 403);
  console.log('ok  student dashboard + add face');

  // ---- teacher subjects summary
  const ts = await ok('teacher-subjects', {}, T);
  assert.strictEqual(ts.subjects[0].total_students, 2);
  assert.strictEqual(ts.subjects[0].total_classes, 1);
  console.log('ok  teacher subjects');

  // ---- ownership: another teacher can't touch it
  await ok('teacher-register', { username: 'other.teacher', name: 'Other', password: 'secret123' });
  const T2 = (await ok('teacher-login', { username: 'other.teacher', password: 'secret123' })).token;
  await fails('subject-roster', { subject_id: sub.subject_id }, T2, 404);
  await fails('session-delete', { subject_id: sub.subject_id, timestamp: second }, T2, 404);
  console.log('ok  ownership');

  // ---- remove student, delete subject
  await ok('subject-remove-student', { subject_id: sub.subject_id, student_id: regB.user.id }, T);
  assert.strictEqual((await ok('subject-roster', { subject_id: sub.subject_id }, T)).students.length, 1);
  await ok('student-unenroll', { subject_id: sub.subject_id }, SA);
  await ok('subject-delete', { subject_id: sub.subject_id }, T);
  assert.strictEqual(tables.subjects.rows.length, 0);
  assert.strictEqual(tables.attendance_logs.rows.length, 0);
  console.log('ok  cleanup');

  // ---- friendly error when the SQL migration was not run
  global.__noFaceColumn = true;
  const e = await fails('student-login', { descriptor: A }, null, 500);
  assert.ok(/schema\.sql/.test(e.error), e.error);
  console.log('ok  missing-column hint');

  mock.close();
  console.log('\nALL API TESTS PASSED');
}

main().catch((e) => {
  console.error('\nTEST FAILED:', e.message);
  process.exit(1);
});
