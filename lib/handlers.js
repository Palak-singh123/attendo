'use strict';
const db = require('./supabase');
const auth = require('./auth');
const face = require('./face');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
const bad = (m) => new ApiError(400, m);

const TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days
const AT_RISK_PERCENT = 75;
const LOGIN_THRESHOLD = 0.48; // stricter than attendance: it unlocks an account
const DUPLICATE_THRESHOLD = 0.5;
const MAX_FACE_SAMPLES = 6;

/* ------------------------------------------------------------------ utils */

const str = (v) => (typeof v === 'string' ? v : '');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const nowTs = () => new Date().toISOString().slice(0, 19);

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function schemaHint(e) {
  if (e instanceof db.DbError && (e.code === '42703' || /face_descriptor/.test(e.message || ''))) {
    return new ApiError(
      500,
      'Database setup is incomplete. Open Supabase -> SQL Editor and run supabase/schema.sql once.'
    );
  }
  return e;
}

async function selectIn(table, column, ids, params, orderBy) {
  const out = [];
  for (const part of chunks(ids, 150)) {
    const rows = await db.selectAll(table, { ...params, [column]: db.inList(part) }, orderBy);
    out.push(...rows);
  }
  return out;
}

async function fetchStudentsByIds(ids) {
  if (!ids.length) return [];
  return selectIn('students', 'student_id', ids, { select: 'student_id,name' }, 'student_id.asc');
}

async function fetchLogsForSubjects(subjectIds) {
  if (!subjectIds.length) return [];
  return selectIn(
    'attendance_logs',
    'subject_id',
    subjectIds,
    { select: 'student_id,subject_id,timestamp,is_present' },
    'timestamp.asc,student_id.asc'
  );
}

async function loadFaceCandidates() {
  let rows;
  try {
    rows = await db.selectAll(
      'students',
      { select: 'student_id,name,face_descriptor', face_descriptor: 'not.is.null' },
      'student_id.asc'
    );
  } catch (e) {
    throw schemaHint(e);
  }
  return rows
    .map((r) => ({ student_id: r.student_id, name: r.name, samples: face.parseStored(r.face_descriptor) }))
    .filter((c) => c.samples.length > 0);
}

async function getRoster(subjectId) {
  const enr = await db.selectAll(
    'subject_students',
    { select: 'student_id', subject_id: 'eq.' + db.safeId(subjectId) },
    'student_id.asc'
  );
  const ids = enr.map((e) => e.student_id);
  const students = await fetchStudentsByIds(ids);
  const byId = new Map(students.map((s) => [String(s.student_id), s]));
  // Keep only enrollments whose student row exists.
  return ids
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function ownSubject(ctx, id) {
  const sid = db.safeId(id);
  const rows = await db.select('subjects', {
    select: 'subject_id,subject_code,name,section,teacher_id',
    subject_id: 'eq.' + sid,
    limit: '1',
  });
  const s = rows[0];
  if (!s || String(s.teacher_id) !== String(ctx.user.id)) throw new ApiError(404, 'Subject not found.');
  return s;
}

async function findSubjectByCode(raw) {
  const code = str(raw).trim();
  if (!code || code.length > 40) return null;
  const variants = [...new Set([code.toUpperCase(), code, code.toLowerCase()])];
  for (const v of variants) {
    const rows = await db.select('subjects', {
      select: 'subject_id,subject_code,name,section,teacher_id',
      subject_code: 'eq.' + v,
      limit: '1',
    });
    if (rows[0]) return rows[0];
  }
  return null;
}

/** Per-student + per-session summary from raw logs. */
function summarizeLogs(logs) {
  const students = new Map();
  const sessions = new Map();
  for (const l of logs) {
    const sid = String(l.student_id);
    const st = students.get(sid) || { attended: 0, total: 0 };
    st.total += 1;
    if (l.is_present) st.attended += 1;
    students.set(sid, st);

    const key = l.timestamp;
    const se = sessions.get(key) || { present: 0, total: 0 };
    se.total += 1;
    if (l.is_present) se.present += 1;
    sessions.set(key, se);
  }
  return { students, sessions };
}

const pct = (a, t) => (t > 0 ? Math.round((a / t) * 1000) / 10 : null);

function validTimestampString(ts) {
  return typeof ts === 'string' && ts.length >= 10 && ts.length <= 40 && !Number.isNaN(Date.parse(ts));
}

function userToken(role, user) {
  return auth.sign({ role, id: user.id, name: user.name }, TOKEN_TTL);
}

/* ---------------------------------------------------------------- actions */

const actions = {};

/* ---- public ------------------------------------------------------------ */

actions.health = {
  auth: null,
  async run() {
    const out = {
      ok: true,
      configured: db.isConfigured(),
      bcrypt: auth.hasBcrypt(),
      sessionSecret: Boolean(process.env.SESSION_SECRET),
      host: db.hostOf(),
      database: null,
      faceColumn: null,
    };
    if (out.configured && !/\.supabase\.(co|in)$/i.test(out.host)) {
      out.hint = `SUPABASE_URL looks wrong (host: "${out.host}"). It should look like https://abcdefgh.supabase.co`;
    }
    if (!out.configured) {
      out.ok = false;
      out.hint = 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.';
      return out;
    }
    try {
      await db.select('teachers', { select: 'teacher_id', limit: '1' });
      out.database = true;
    } catch (e) {
      out.database = false;
      out.ok = false;
      out.hint = (out.hint ? out.hint + ' ' : '') + 'Database not reachable or tables missing: ' + e.message;
      return out;
    }
    try {
      await db.select('students', { select: 'face_descriptor', limit: '1' });
      out.faceColumn = true;
    } catch (e) {
      out.faceColumn = false;
      out.ok = false;
      out.hint = 'Run supabase/schema.sql in the Supabase SQL editor (adds students.face_descriptor).';
    }
    return out;
  },
};

actions['teacher-register'] = {
  auth: null,
  async run(ctx, body) {
    const username = str(body.username).trim().toLowerCase();
    const name = str(body.name).trim();
    const password = str(body.password);
    if (!username || !name || !password) throw bad('All fields are required.');
    if (!/^[a-z0-9._@-]{3,40}$/.test(username))
      throw bad('Username must be 3-40 characters: letters, numbers, dot, dash or underscore.');
    if (name.length < 2 || name.length > 60) throw bad('Enter your full name (2-60 characters).');
    if (password.length < 6 || password.length > 72) throw bad('Password must be 6-72 characters.');

    const key = 'register:' + ctx.ip;
    if (auth.tooMany(key, 10)) throw new ApiError(429, 'Too many attempts. Try again later.');
    auth.recordFailure(key);

    const exists = await db.select('teachers', { select: 'teacher_id', username: 'eq.' + username, limit: '1' });
    if (exists.length) throw new ApiError(409, 'That username is already taken.');

    const hashed = await auth.hashPassword(password);
    await db.insert('teachers', [{ username, password: hashed, name }]);
    return { ok: true };
  },
};

actions['teacher-login'] = {
  auth: null,
  async run(ctx, body) {
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!username || !password) throw bad('Enter your username and password.');
    const key = 'login:' + ctx.ip + ':' + username.toLowerCase();
    if (auth.tooMany(key)) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');

    let rows = await db.select('teachers', {
      select: 'teacher_id,username,name,password',
      username: 'eq.' + username,
      limit: '1',
    });
    if (!rows.length && username !== username.toLowerCase()) {
      rows = await db.select('teachers', {
        select: 'teacher_id,username,name,password',
        username: 'eq.' + username.toLowerCase(),
        limit: '1',
      });
    }
    const t = rows[0];
    const ok = t ? await auth.verifyPassword(password, t.password) : false;
    if (!ok) {
      auth.recordFailure(key);
      throw new ApiError(401, 'Invalid username or password.');
    }
    auth.clearFailures(key);
    const user = { id: t.teacher_id, name: t.name, username: t.username };
    return { token: userToken('teacher', user), user: { ...user, role: 'teacher' } };
  },
};

actions['student-login'] = {
  auth: null,
  async run(ctx, body) {
    const key = 'slogin:' + ctx.ip;
    if (auth.tooMany(key, 30)) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
    const q = face.sanitize(Array.isArray(body.descriptor) ? body.descriptor : null);
    if (!q) throw bad('Could not read your face. Please try again.');

    const candidates = await loadFaceCandidates();
    const m = face.matchOne(q, candidates, { threshold: LOGIN_THRESHOLD, margin: 0.05 });
    if (!m.best) {
      auth.recordFailure(key, 5 * 60 * 1000);
      return { matched: false };
    }
    auth.clearFailures(key);
    const user = { id: m.best.student_id, name: m.best.name };
    return {
      matched: true,
      token: userToken('student', user),
      user: { ...user, role: 'student' },
      score: face.score(m.distance),
    };
  },
};

actions['student-register'] = {
  auth: null,
  async run(ctx, body) {
    const name = str(body.name).trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) throw bad('Enter your name (2-60 characters).');
    const raw = Array.isArray(body.descriptors) ? body.descriptors.slice(0, 5) : [];
    const samples = raw.map((d) => face.sanitize(d)).filter(Boolean);
    if (samples.length < 1) throw bad('No face was captured. Please try again.');

    // The samples must all be the same person.
    for (let i = 0; i < samples.length; i++)
      for (let j = i + 1; j < samples.length; j++)
        if (face.euclid(samples[i], samples[j]) > 0.65)
          throw bad('The photos do not look like the same person. Make sure only you are in front of the camera.');

    const key = 'sreg:' + ctx.ip;
    if (auth.tooMany(key, 10, 60 * 60 * 1000)) throw new ApiError(429, 'Too many sign-ups from this network. Try later.');

    const candidates = await loadFaceCandidates();
    for (const s of samples) {
      const m = face.matchOne(s, candidates, { threshold: DUPLICATE_THRESHOLD, margin: 0 });
      if (m.best) throw new ApiError(409, `This face is already registered as "${m.best.name}". Use face login instead.`);
    }
    auth.recordFailure(key, 60 * 60 * 1000);

    let created;
    try {
      created = await db.insert('students', [{ name, face_descriptor: samples }]);
    } catch (e) {
      throw schemaHint(e);
    }
    const row = created && created[0];
    if (!row) throw new ApiError(500, 'Could not create the profile. Please try again.');
    const user = { id: row.student_id, name: row.name };
    return { token: userToken('student', user), user: { ...user, role: 'student' } };
  },
};

/* ---- shared ------------------------------------------------------------ */

actions.session = {
  auth: 'any',
  async run(ctx) {
    return { user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role } };
  },
};

/* ---- student ----------------------------------------------------------- */

actions['student-dashboard'] = {
  auth: 'student',
  async run(ctx) {
    const sid = db.safeId(ctx.user.id);
    const enr = await db.selectAll('subject_students', { select: 'subject_id', student_id: 'eq.' + sid }, 'subject_id.asc');
    const subjectIds = enr.map((e) => e.subject_id);
    const subjects = subjectIds.length
      ? await selectIn(
          'subjects',
          'subject_id',
          subjectIds,
          { select: 'subject_id,subject_code,name,section,teacher_id' },
          'subject_id.asc'
        )
      : [];
    const teacherIds = [...new Set(subjects.map((s) => s.teacher_id).filter((v) => v != null))];
    const teachers = teacherIds.length
      ? await selectIn('teachers', 'teacher_id', teacherIds, { select: 'teacher_id,name' }, 'teacher_id.asc')
      : [];
    const teacherName = new Map(teachers.map((t) => [String(t.teacher_id), t.name]));

    const logs = await db.selectAll(
      'attendance_logs',
      { select: 'subject_id,timestamp,is_present', student_id: 'eq.' + sid },
      'timestamp.asc'
    );
    const bySubject = new Map();
    for (const l of logs) {
      const k = String(l.subject_id);
      if (!bySubject.has(k)) bySubject.set(k, []);
      bySubject.get(k).push({ timestamp: l.timestamp, present: Boolean(l.is_present) });
    }

    let faceSamples = 0;
    try {
      const me = await db.select('students', { select: 'face_descriptor', student_id: 'eq.' + sid, limit: '1' });
      faceSamples = me[0] ? face.parseStored(me[0].face_descriptor).length : 0;
    } catch (_) {
      faceSamples = 0;
    }

    return {
      student: { id: ctx.user.id, name: ctx.user.name, faceSamples },
      subjects: subjects
        .map((s) => {
          const list = bySubject.get(String(s.subject_id)) || [];
          const attended = list.filter((x) => x.present).length;
          return {
            subject_id: s.subject_id,
            subject_code: s.subject_code,
            name: s.name,
            section: s.section,
            teacher: teacherName.get(String(s.teacher_id)) || null,
            total: list.length,
            attended,
            percent: pct(attended, list.length),
            history: list.slice(-30),
          };
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  },
};

actions['subject-lookup'] = {
  auth: 'student',
  async run(ctx, body) {
    const s = await findSubjectByCode(body.code);
    if (!s) throw new ApiError(404, `Subject code "${str(body.code).trim().toUpperCase()}" was not found.`);
    const enrolled = await db.select('subject_students', {
      select: 'student_id',
      student_id: 'eq.' + db.safeId(ctx.user.id),
      subject_id: 'eq.' + db.safeId(s.subject_id),
      limit: '1',
    });
    let teacher = null;
    if (s.teacher_id != null) {
      const t = await db.select('teachers', { select: 'name', teacher_id: 'eq.' + db.safeId(s.teacher_id), limit: '1' });
      teacher = t[0] ? t[0].name : null;
    }
    return {
      subject: { subject_id: s.subject_id, subject_code: s.subject_code, name: s.name, section: s.section, teacher },
      enrolled: enrolled.length > 0,
    };
  },
};

actions['student-enroll'] = {
  auth: 'student',
  async run(ctx, body) {
    const s = await findSubjectByCode(body.code);
    if (!s) throw new ApiError(404, `Subject code "${str(body.code).trim().toUpperCase()}" was not found.`);
    const exists = await db.select('subject_students', {
      select: 'student_id',
      student_id: 'eq.' + db.safeId(ctx.user.id),
      subject_id: 'eq.' + db.safeId(s.subject_id),
      limit: '1',
    });
    if (exists.length) throw new ApiError(409, `You are already enrolled in ${s.name}.`);
    await db.insert('subject_students', [{ student_id: ctx.user.id, subject_id: s.subject_id }]);
    return { ok: true, subject: { subject_id: s.subject_id, name: s.name, subject_code: s.subject_code } };
  },
};

actions['student-unenroll'] = {
  auth: 'student',
  async run(ctx, body) {
    await db.remove('subject_students', {
      student_id: 'eq.' + db.safeId(ctx.user.id),
      subject_id: 'eq.' + db.safeId(body.subject_id),
    });
    return { ok: true };
  },
};

actions['student-add-face'] = {
  auth: 'student',
  async run(ctx, body) {
    const sid = db.safeId(ctx.user.id);
    const incoming = (Array.isArray(body.descriptors) ? body.descriptors.slice(0, 3) : [])
      .map((d) => face.sanitize(d))
      .filter(Boolean);
    if (!incoming.length) throw bad('No face was captured. Please try again.');
    let rows;
    try {
      rows = await db.select('students', { select: 'face_descriptor', student_id: 'eq.' + sid, limit: '1' });
    } catch (e) {
      throw schemaHint(e);
    }
    const existing = rows[0] ? face.parseStored(rows[0].face_descriptor) : [];
    if (existing.length) {
      const same = incoming.some((q) => face.minDistance(q, existing) <= DUPLICATE_THRESHOLD);
      if (!same) throw new ApiError(403, 'This face does not match your profile.');
    }
    const merged = [...existing, ...incoming].slice(-MAX_FACE_SAMPLES);
    await db.update('students', { student_id: 'eq.' + sid }, { face_descriptor: merged });
    return { ok: true, faceSamples: merged.length };
  },
};

/* ---- teacher: subjects -------------------------------------------------- */

actions['teacher-subjects'] = {
  auth: 'teacher',
  async run(ctx) {
    const subjects = await db.selectAll(
      'subjects',
      { select: 'subject_id,subject_code,name,section', teacher_id: 'eq.' + db.safeId(ctx.user.id) },
      'subject_id.asc'
    );
    const ids = subjects.map((s) => s.subject_id);
    const enroll = ids.length
      ? await selectIn('subject_students', 'subject_id', ids, { select: 'subject_id,student_id' }, 'subject_id.asc,student_id.asc')
      : [];
    const logs = await fetchLogsForSubjects(ids);

    const enrollCount = new Map();
    for (const e of enroll) enrollCount.set(String(e.subject_id), (enrollCount.get(String(e.subject_id)) || 0) + 1);
    const logsBySubject = new Map();
    for (const l of logs) {
      const k = String(l.subject_id);
      if (!logsBySubject.has(k)) logsBySubject.set(k, []);
      logsBySubject.get(k).push(l);
    }

    return {
      subjects: subjects.map((s) => {
        const list = logsBySubject.get(String(s.subject_id)) || [];
        const sum = summarizeLogs(list);
        let present = 0;
        let total = 0;
        let last = null;
        for (const [ts, v] of sum.sessions) {
          present += v.present;
          total += v.total;
          if (!last || ts > last) last = ts;
        }
        let atRisk = 0;
        for (const v of sum.students.values()) if (v.total >= 3 && (v.attended / v.total) * 100 < AT_RISK_PERCENT) atRisk += 1;
        return {
          ...s,
          total_students: enrollCount.get(String(s.subject_id)) || 0,
          total_classes: sum.sessions.size,
          avg_attendance: pct(present, total),
          last_session: last,
          at_risk: atRisk,
        };
      }),
    };
  },
};

actions['subject-create'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const code = str(body.subject_code).trim().toUpperCase();
    const name = str(body.name).trim();
    const section = str(body.section).trim();
    if (!code || !name || !section) throw bad('Please fill in all the fields.');
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code))
      throw bad('Subject code: 2-20 letters, numbers, dash or underscore (e.g. CS101).');
    if (name.length > 80) throw bad('Subject name is too long (max 80).');
    if (section.length > 20) throw bad('Section is too long (max 20).');
    if (await findSubjectByCode(code)) throw new ApiError(409, `Subject code ${code} already exists. Choose another code.`);
    const rows = await db.insert('subjects', [{ subject_code: code, name, section, teacher_id: ctx.user.id }]);
    return { subject: rows && rows[0] };
  },
};

actions['subject-delete'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    const id = 'eq.' + db.safeId(s.subject_id);
    await db.remove('attendance_logs', { subject_id: id });
    await db.remove('subject_students', { subject_id: id });
    await db.remove('subjects', { subject_id: id });
    return { ok: true };
  },
};

actions['subject-roster'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    const roster = await getRoster(s.subject_id);
    const logs = await fetchLogsForSubjects([s.subject_id]);
    const sum = summarizeLogs(logs);

    let withFace = new Set();
    if (roster.length) {
      try {
        const rows = await selectIn(
          'students',
          'student_id',
          roster.map((r) => r.student_id),
          { select: 'student_id', face_descriptor: 'not.is.null' },
          'student_id.asc'
        );
        withFace = new Set(rows.map((r) => String(r.student_id)));
      } catch (_) {
        withFace = new Set();
      }
    }

    return {
      subject: s,
      sessions: sum.sessions.size,
      students: roster.map((r) => {
        const st = sum.students.get(String(r.student_id)) || { attended: 0, total: 0 };
        return {
          student_id: r.student_id,
          name: r.name,
          attended: st.attended,
          total: st.total,
          percent: pct(st.attended, st.total),
          has_face: withFace.has(String(r.student_id)),
        };
      }),
    };
  },
};

actions['subject-remove-student'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    await db.remove('subject_students', {
      subject_id: 'eq.' + db.safeId(s.subject_id),
      student_id: 'eq.' + db.safeId(body.student_id),
    });
    return { ok: true };
  },
};

/* ---- teacher: taking attendance ----------------------------------------- */

actions['attendance-match'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const subject = await ownSubject(ctx, body.subject_id);
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 12) : [];
    if (!photos.length) throw bad('Add at least one photo.');
    const threshold = clamp(Number(body.threshold) || 0.5, 0.35, 0.65);

    const roster = await getRoster(subject.subject_id);
    if (!roster.length) throw bad('No students are enrolled in this subject yet.');
    const enrolled = new Set(roster.map((r) => String(r.student_id)));
    const candidates = await loadFaceCandidates();
    const hasFace = new Set(candidates.map((c) => String(c.student_id)));

    const presence = new Map(); // student_id -> { photos:Set<number>, distance }
    const photoResults = [];
    let facesTotal = 0;

    photos.forEach((photo, pi) => {
      const raw = Array.isArray(photo && photo.descriptors) ? photo.descriptors.slice(0, 150) : [];
      const faces = raw.map((d) => {
        const q = face.sanitize(d);
        if (!q) return { status: 'invalid', distance: null, score: 0 };
        const m = face.matchOne(q, candidates, { threshold, margin: 0.04 });
        if (!m.best) return { status: 'unknown', distance: m.distance, score: 0 };
        return {
          status: enrolled.has(String(m.best.student_id)) ? 'matched' : 'not_enrolled',
          student_id: m.best.student_id,
          name: m.best.name,
          distance: m.distance,
          score: face.score(m.distance),
        };
      });

      // One face per student per photo: keep the closest, demote the rest.
      const best = new Map();
      faces.forEach((f, i) => {
        if (f.student_id == null) return;
        const k = String(f.student_id);
        if (!best.has(k) || f.distance < faces[best.get(k)].distance) best.set(k, i);
      });
      faces.forEach((f, i) => {
        if (f.student_id != null && best.get(String(f.student_id)) !== i) {
          f.status = 'duplicate';
        }
      });

      faces.forEach((f) => {
        facesTotal += 1;
        if (f.status === 'matched') {
          const k = String(f.student_id);
          const p = presence.get(k) || { photos: new Set(), distance: Infinity };
          p.photos.add(pi + 1);
          p.distance = Math.min(p.distance, f.distance);
          presence.set(k, p);
        }
      });
      photoResults.push({
        faces: faces.map((f) => ({
          status: f.status,
          student_id: f.student_id == null ? null : f.student_id,
          name: f.name || null,
          score: f.score,
        })),
      });
    });

    const matchedCount = presence.size;
    return {
      photos: photoResults,
      roster: roster.map((r) => {
        const p = presence.get(String(r.student_id));
        return {
          student_id: r.student_id,
          name: r.name,
          present: Boolean(p),
          score: p ? face.score(p.distance) : 0,
          photos: p ? [...p.photos].sort((a, b) => a - b) : [],
          has_face: hasFace.has(String(r.student_id)),
        };
      }),
      summary: { faces: facesTotal, matched: matchedCount, enrolled: roster.length },
    };
  },
};

actions['attendance-save'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const subject = await ownSubject(ctx, body.subject_id);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) throw bad('Nothing to save.');
    if (entries.length > 3000) throw bad('Too many entries.');

    let ts = nowTs();
    if (body.timestamp != null) {
      if (!validTimestampString(body.timestamp)) throw bad('Invalid date and time.');
      const d = new Date(body.timestamp);
      if (d.getTime() > Date.now() + 10 * 60 * 1000) throw bad('Attendance cannot be saved for a future time.');
      ts = d.toISOString().slice(0, 19);
    }

    const roster = await getRoster(subject.subject_id);
    const rosterById = new Map(roster.map((r) => [String(r.student_id), r]));
    const seen = new Set();
    const rows = [];
    for (const e of entries) {
      const k = String(e && e.student_id);
      if (!rosterById.has(k) || seen.has(k)) continue;
      seen.add(k);
      rows.push({
        student_id: rosterById.get(k).student_id,
        subject_id: subject.subject_id,
        timestamp: ts,
        is_present: Boolean(e.is_present),
      });
    }
    if (!rows.length) throw bad('None of these students are enrolled in this subject.');

    const dup = await db.select('attendance_logs', {
      select: 'student_id',
      subject_id: 'eq.' + db.safeId(subject.subject_id),
      timestamp: 'eq.' + ts,
      limit: '1',
    });
    if (dup.length) throw new ApiError(409, 'Attendance for this exact time is already saved.');

    for (const part of chunks(rows, 500)) await db.insert('attendance_logs', part);
    return { ok: true, saved: rows.length, present: rows.filter((r) => r.is_present).length, timestamp: ts };
  },
};

/* ---- teacher: records --------------------------------------------------- */

actions['attendance-records'] = {
  auth: 'teacher',
  async run(ctx, body) {
    let subjects;
    if (body.subject_id) {
      subjects = [await ownSubject(ctx, body.subject_id)];
    } else {
      subjects = await db.selectAll(
        'subjects',
        { select: 'subject_id,subject_code,name,section', teacher_id: 'eq.' + db.safeId(ctx.user.id) },
        'subject_id.asc'
      );
    }
    const logs = await fetchLogsForSubjects(subjects.map((s) => s.subject_id));
    const grouped = new Map();
    for (const l of logs) {
      const key = l.subject_id + '|' + l.timestamp;
      const g = grouped.get(key) || { subject_id: l.subject_id, timestamp: l.timestamp, present: 0, total: 0 };
      g.total += 1;
      if (l.is_present) g.present += 1;
      grouped.set(key, g);
    }
    const sessions = [...grouped.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    return {
      subjects: subjects.map((s) => ({
        subject_id: s.subject_id,
        subject_code: s.subject_code,
        name: s.name,
        section: s.section,
      })),
      sessions,
    };
  },
};

actions['subject-matrix'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    const roster = await getRoster(s.subject_id);
    const logs = await fetchLogsForSubjects([s.subject_id]);
    const tsList = [...new Set(logs.map((l) => l.timestamp))].sort();
    const idx = new Map(tsList.map((t, i) => [t, i]));
    const marks = new Map();
    for (const l of logs) {
      const k = String(l.student_id);
      if (!marks.has(k)) marks.set(k, new Array(tsList.length).fill(null));
      marks.get(k)[idx.get(l.timestamp)] = l.is_present ? 1 : 0;
    }
    return {
      subject: s,
      sessions: tsList,
      students: roster.map((r) => ({
        student_id: r.student_id,
        name: r.name,
        marks: marks.get(String(r.student_id)) || new Array(tsList.length).fill(null),
      })),
    };
  },
};

actions['session-detail'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    if (!validTimestampString(body.timestamp)) throw bad('Invalid session.');
    const logs = await db.selectAll(
      'attendance_logs',
      { select: 'student_id,is_present', subject_id: 'eq.' + db.safeId(s.subject_id), timestamp: 'eq.' + body.timestamp },
      'student_id.asc'
    );
    const students = await fetchStudentsByIds(logs.map((l) => l.student_id));
    const names = new Map(students.map((x) => [String(x.student_id), x.name]));
    return {
      subject: s,
      timestamp: body.timestamp,
      entries: logs
        .map((l) => ({
          student_id: l.student_id,
          name: names.get(String(l.student_id)) || 'Unknown student',
          is_present: Boolean(l.is_present),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  },
};

actions['session-update'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    if (!validTimestampString(body.timestamp)) throw bad('Invalid session.');
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, 3000) : [];
    if (!entries.length) throw bad('Nothing to update.');
    let changed = 0;
    for (const part of chunks(entries, 20)) {
      await Promise.all(
        part.map(async (e) => {
          await db.update(
            'attendance_logs',
            {
              subject_id: 'eq.' + db.safeId(s.subject_id),
              timestamp: 'eq.' + body.timestamp,
              student_id: 'eq.' + db.safeId(e.student_id),
            },
            { is_present: Boolean(e.is_present) }
          );
          changed += 1;
        })
      );
    }
    return { ok: true, updated: changed };
  },
};

actions['session-delete'] = {
  auth: 'teacher',
  async run(ctx, body) {
    const s = await ownSubject(ctx, body.subject_id);
    if (!validTimestampString(body.timestamp)) throw bad('Invalid session.');
    await db.remove('attendance_logs', {
      subject_id: 'eq.' + db.safeId(s.subject_id),
      timestamp: 'eq.' + body.timestamp,
    });
    return { ok: true };
  },
};

/* ---------------------------------------------------------------- dispatch */

async function handle(action, body, ctx) {
  const def = actions[action];
  if (!def) throw new ApiError(404, 'Unknown action.');
  if (def.auth) {
    const payload = ctx.token ? auth.verify(ctx.token) : null;
    if (!payload) throw new ApiError(401, 'Your session expired. Please log in again.');
    if (def.auth !== 'any' && payload.role !== def.auth) throw new ApiError(403, 'This action is not allowed for your account.');
    ctx.user = { id: payload.id, name: payload.name, role: payload.role };
  }
  return def.run(ctx, body || {});
}

module.exports = { handle, ApiError, actions };
