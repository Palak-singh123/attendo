import { h, icon, clear, store, loadImage } from '../util.js';
import { api } from '../api.js';
import { toast, openModal, busy, emptyState, loadingBlock } from '../ui.js';
import { createCamera, detectGroup } from '../face.js';
import { speechSupported, listen, matchNames, LANGS } from '../voice.js';
import { errorCard } from './common.js';
import { openReview } from './review.js';

const MAX_PHOTOS = 12;
let photos = []; // kept while the teacher switches tabs: [{ id, canvas }]
let photoId = 0;

function fitToCanvas(source, maxSide = 2000) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function thumb(canvas) {
  const t = document.createElement('canvas');
  const w = 360;
  t.width = w;
  t.height = Math.round((canvas.height / canvas.width) * w);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t;
}

export function renderAttendanceTab(root, ctx) {
  let disposed = false;
  const holder = h('div', null, loadingBlock('Loading your subjects...'));
  root.append(holder);

  (async () => {
    try {
      const subjects = await ctx.getSubjects();
      if (disposed) return;
      clear(holder);
      if (!subjects.length) {
        holder.append(
          h(
            'div',
            { class: 'card' },
            emptyState('book', 'Create a subject first', 'Attendance is taken per subject. Create one and share its code with your students.', h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.goTab('subjects') }, icon('plus'), 'Create subject'))
          )
        );
        return;
      }
      build(holder, subjects);
    } catch (e) {
      if (disposed) return;
      clear(holder);
      holder.append(errorCard(e.message, () => renderAgain()));
    }
  })();

  function renderAgain() {
    clear(root);
    disposed = true;
    renderAttendanceTab(root, ctx);
  }

  function build(container, subjects) {
    const last = store.get('attendo.lastSubject', null);
    const select = h(
      'select',
      { class: 'input', id: 'att-subject', 'aria-label': 'Subject' },
      subjects.map((s) => h('option', { value: s.subject_id, selected: String(s.subject_id) === String(last) }, `${s.name} - ${s.subject_code}`))
    );
    select.addEventListener('change', () => store.set('attendo.lastSubject', select.value));
    const currentSubject = () => subjects.find((s) => String(s.subject_id) === String(select.value)) || subjects[0];

    const grid = h('div', { class: 'photo-grid' });
    const emptyMsg = h('p', { class: 'hint', style: { margin: '14px 0' } }, 'No photos yet. Add a clear photo of the class (or several, from different angles) and Attendo will find everyone.');
    const runBtn = h('button', { class: 'btn primary', type: 'button' }, icon('zap'), 'Run face analysis');
    const clearBtn = h('button', { class: 'btn ghost', type: 'button' }, icon('trash'), 'Clear all photos');

    const strict = Number(store.get('attendo.strict', 0.5)) || 0.5;
    const strictInput = h('input', { type: 'range', min: 0.4, max: 0.6, step: 0.01, value: strict, 'aria-label': 'Matching strictness' });
    strictInput.addEventListener('change', () => store.set('attendo.strict', Number(strictInput.value)));

    function paintPhotos() {
      clear(grid);
      photos.forEach((p, i) => {
        const t = thumb(p.canvas);
        grid.append(
          h(
            'div',
            { class: 'photo' },
            t,
            h('button', { class: 'rm', type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { photos = photos.filter((x) => x.id !== p.id); paintPhotos(); } }, icon('x')),
            h('div', { class: 'cap' }, `Photo ${i + 1}`)
          )
        );
      });
      emptyMsg.hidden = photos.length > 0;
      grid.hidden = photos.length === 0;
      runBtn.disabled = photos.length === 0;
      clearBtn.disabled = photos.length === 0;
    }

    clearBtn.addEventListener('click', () => {
      photos = [];
      paintPhotos();
    });

    runBtn.addEventListener('click', () => analyse(currentSubject(), Number(strictInput.value), runBtn));

    container.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'section-title' }, 'Take AI attendance'), h('p', { class: 'hint' }, 'Photo, voice or tap: pick whatever suits the class.'))),
        h(
          'div',
          { class: 'filters' },
          h('div', { class: 'field' }, h('label', { for: 'att-subject' }, 'Subject'), select),
          h('button', { class: 'btn secondary', type: 'button', onclick: () => addPhotosDialog(paintPhotos) }, icon('camera'), 'Add photos')
        ),
        emptyMsg,
        grid,
        h(
          'div',
          { class: 'field' },
          h('label', null, 'Matching strictness'),
          strictInput,
          h('div', { class: 'row hint', style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Strict: fewer wrong matches'), h('span', null, 'Lenient: finds more faces'))
        ),
        h('div', { class: 'btn-row' }, runBtn, h('button', { class: 'btn secondary', type: 'button', onclick: () => voiceFlow(currentSubject()) }, icon('mic'), 'Use voice attendance'), h('button', { class: 'btn ghost', type: 'button', onclick: () => manualFlow(currentSubject()) }, icon('list'), 'Mark manually'), clearBtn)
      )
    );
    paintPhotos();
  }

  /* ---------------------------------------------------------- analysis */
  async function analyse(subject, threshold, btn) {
    if (!photos.length) return;
    const text = h('p', { style: { textAlign: 'center' } }, 'Starting...');
    const m = openModal({
      title: 'Scanning classroom photos',
      dismissable: false,
      body: h('div', { class: 'loading-page' }, h('span', { class: 'spin' }), text, h('p', { class: 'hint' }, 'Photos are analysed on your device. Nothing is uploaded except face numbers.')),
    });
    try {
      const results = [];
      for (let i = 0; i < photos.length; i++) {
        const r = await detectGroup(photos[i].canvas, (t) => t && (text.textContent = `Photo ${i + 1} of ${photos.length}: ${t}`));
        results.push(r);
      }
      text.textContent = 'Matching faces with your students...';
      const res = await api('attendance-match', {
        subject_id: subject.subject_id,
        threshold,
        photos: results.map((r) => ({ descriptors: r.faces.map((f) => f.descriptor) })),
      });
      m.close();
      if (disposed) return;
      if (res.summary.faces === 0) toast('No faces were found. Try a closer or brighter photo, or mark manually below.', 'err', 6000);
      openReview({
        subject,
        source: 'face',
        rows: res.roster,
        photos: results.map((r, i) => ({ canvas: r.canvas, faces: r.faces, matches: res.photos[i].faces })),
        onSaved: () => {
          photos = [];
          ctx.invalidate();
          if (!disposed) renderAgain();
        },
      });
    } catch (e) {
      m.close();
      toast(e.message, 'err', 6000);
    }
  }

  /* ------------------------------------------------------------ manual */
  async function manualFlow(subject, preset) {
    try {
      const data = await api('subject-roster', { subject_id: subject.subject_id });
      if (!data.students.length) return toast('No students are enrolled in this subject yet.', 'err');
      openReview({
        subject,
        source: preset ? 'voice' : 'manual',
        rows: data.students.map((s) => ({ student_id: s.student_id, name: s.name, present: preset ? preset.get(s.student_id) === 'heard' : false, note: preset && preset.get(s.student_id) === 'maybe' ? 'Maybe heard: please confirm' : preset && preset.get(s.student_id) === 'heard' ? 'Heard in recording' : '' })),
        onSaved: () => ctx.invalidate(),
      });
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* ------------------------------------------------------------- voice */
  async function voiceFlow(subject) {
    if (!speechSupported()) {
      const m = openModal({
        title: 'Voice attendance',
        body: h('p', null, 'This browser does not support speech recognition. Use Chrome, Edge or Safari on your phone or computer, or mark attendance with a photo or by hand.'),
        footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => { m.close(); manualFlow(subject); } }, 'Mark manually')],
      });
      return;
    }
    let roster;
    try {
      roster = (await api('subject-roster', { subject_id: subject.subject_id })).students;
    } catch (e) {
      return toast(e.message, 'err');
    }
    if (!roster.length) return toast('No students are enrolled in this subject yet.', 'err');

    let finalText = '';
    let interim = '';
    let listener = null;
    const lang = h('select', { class: 'input', 'aria-label': 'Language' }, LANGS.map((l) => h('option', { value: l.code }, l.label)));
    const transcript = h('div', { class: 'transcript', 'aria-live': 'polite' }, h('span', { class: 'hint' }, 'The words you hear will appear here.'));
    const chips = h('div', { class: 'name-chips' });
    const status = h('p', { class: 'hint' });
    const toggle = h('button', { class: 'btn primary', type: 'button' }, icon('mic'), 'Start listening');
    const review = h('button', { class: 'btn secondary', type: 'button' }, icon('check'), 'Review attendance');

    function refresh() {
      const all = `${finalText} ${interim}`.trim();
      clear(transcript);
      if (!all) transcript.append(h('span', { class: 'hint' }, 'The words you hear will appear here.'));
      else transcript.append(finalText, interim ? h('span', { class: 'interim' }, ' ' + interim) : null);
      transcript.scrollTop = transcript.scrollHeight;
      const found = matchNames(all, roster);
      clear(chips);
      roster.forEach((s) => {
        const st = found.get(s.student_id);
        chips.append(h('span', { class: 'name-chip' + (st === 'heard' ? ' heard' : st === 'maybe' ? ' maybe' : '') }, s.name));
      });
      return found;
    }
    refresh();

    function stopListening() {
      if (listener) listener.stop();
      listener = null;
      clear(toggle);
      toggle.append(icon('mic'), 'Start listening');
      status.textContent = '';
    }

    toggle.addEventListener('click', () => {
      if (listener) return stopListening();
      finalText = finalText || '';
      clear(toggle);
      toggle.append(h('span', { class: 'mic-pulse' }), 'Stop listening');
      status.textContent = 'Listening... ask each student to say: "I am present, my name is ..."';
      listener = listen({
        lang: lang.value,
        onText: (f, i) => {
          finalText = f;
          interim = i;
          refresh();
        },
        onError: (msg) => {
          toast(msg, 'err', 6000);
          stopListening();
        },
        onEnd: () => {
          if (listener) stopListening();
        },
      });
    });

    const m = openModal({
      title: 'Voice attendance',
      wide: true,
      body: h(
        'div',
        null,
        h('p', { style: { marginBottom: '12px' } }, 'Attendo listens for each student\'s name. Names heard turn green. You can fix anything before saving.'),
        h('div', { class: 'field' }, h('label', null, 'Language'), lang),
        h('div', { class: 'btn-row', style: { marginBottom: '12px' } }, toggle),
        status,
        transcript,
        chips,
        h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Tip: the microphone works best close to the speaker in a quiet room. Speech recognition needs an internet connection.')
      ),
      footer: [review],
      onClose: () => {
        if (listener) listener.stop();
        listener = null;
      },
    });
    review.addEventListener('click', () => {
      const found = refresh();
      m.close();
      manualFlow(subject, found);
    });
  }

  return () => {
    disposed = true;
  };
}

/* ----------------------------------------------------------- add photos */
function addPhotosDialog(onChange) {
  let mode = 'camera';
  let cam = null;
  const view = h('div');
  const count = h('p', { class: 'hint', style: { textAlign: 'center', marginTop: '10px' } });
  const seg = h(
    'div',
    { class: 'seg', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', onclick: () => setMode('camera') }, 'Camera'),
    h('button', { type: 'button', role: 'tab', onclick: () => setMode('upload') }, 'Upload photos')
  );

  const updateCount = () => {
    count.textContent = photos.length ? `Photos added: ${photos.length} of ${MAX_PHOTOS}` : 'No photos added yet.';
  };

  function addCanvas(c) {
    if (photos.length >= MAX_PHOTOS) {
      toast(`You can add up to ${MAX_PHOTOS} photos.`, 'err');
      return false;
    }
    photos.push({ id: ++photoId, canvas: c });
    updateCount();
    onChange();
    return true;
  }

  function stopCam() {
    if (cam) cam.stop();
    cam = null;
  }

  function setMode(next) {
    mode = next;
    [...seg.children].forEach((b, i) => b.setAttribute('aria-selected', (i === 0) === (mode === 'camera') ? 'true' : 'false'));
    stopCam();
    clear(view);
    if (mode === 'camera') {
      cam = createCamera({ facing: 'environment', mirror: false, wide: true, guide: false });
      const snap = h('button', { class: 'btn primary', type: 'button' }, icon('camera'), 'Take snapshot');
      snap.addEventListener('click', () => {
        if (!cam || !cam.isLive()) return toast('The camera is not ready yet.', 'err');
        if (addCanvas(fitToCanvas(cam.capture()))) toast('Photo captured.', 'ok', 1500);
      });
      view.append(cam.el, h('div', { class: 'btn-row', style: { marginTop: '12px' } }, snap, h('button', { class: 'btn ghost', type: 'button', onclick: () => cam && cam.flip() }, icon('refresh'), 'Switch camera')));
      cam.start();
    } else {
      const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'att-files' });
      const zone = h('label', { class: 'dropzone', for: 'att-files' }, icon('upload'), h('p', null, h('b', null, 'Choose photos'), ' or drop them here'), h('p', { class: 'hint' }, 'JPG, PNG or WEBP'));
      const handle = async (files) => {
        let ok = 0;
        for (const f of files) {
          if (!f.type.startsWith('image/')) {
            toast(`${f.name} is not an image.`, 'err');
            continue;
          }
          try {
            const img = await loadImage(f);
            if (!addCanvas(fitToCanvas(img))) break;
            ok += 1;
          } catch (_) {
            toast(`${f.name} could not be read.`, 'err');
          }
        }
        if (ok) toast(`${ok} photo${ok === 1 ? '' : 's'} added.`, 'ok');
      };
      input.addEventListener('change', () => {
        handle([...input.files]);
        input.value = '';
      });
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('over');
        handle([...e.dataTransfer.files]);
      });
      view.append(input, zone);
    }
  }

  const m = openModal({
    title: 'Capture or upload photos',
    wide: true,
    body: h('div', null, h('p', { style: { marginBottom: '12px' } }, 'Add clear photos where every face is visible. More photos from different angles means fewer misses.'), seg, view, count),
    footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, 'Done')],
    onClose: stopCam,
  });
  updateCount();
  setMode('camera');
}
