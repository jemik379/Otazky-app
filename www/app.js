/* app.js — routing a vykreslování obrazovek. Vanilla JS, žádný build krok. */

const app = document.getElementById('app');
const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const tabbar = document.getElementById('tabbar');

let navStack = [];
let current = null; // { render, title, showBack, tab }

function setTab(routeName) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.route === routeName);
  });
}

function show(screen, { push = true } = {}) {
  if (push && current) navStack.push(current);
  current = screen;
  pageTitle.textContent = screen.title;
  backBtn.hidden = navStack.length === 0;
  setTab(screen.tab || '');
  screen.render();
}

function goBack() {
  const prev = navStack.pop();
  if (prev) {
    current = prev;
    pageTitle.textContent = prev.title;
    backBtn.hidden = navStack.length === 0;
    setTab(prev.tab || '');
    prev.render();
  }
}

backBtn.addEventListener('click', goBack);

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    navStack = [];
    backBtn.hidden = true;
    if (t.dataset.route === 'decks') openDecks(false);
    if (t.dataset.route === 'capture') openCapture(false);
    if (t.dataset.route === 'all') openAllQuestions(false);
  });
});

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------------- DECKY ---------------- */

async function openDecks(push = true) {
  show({ title: 'Balíčky', tab: 'decks', render: renderDecks }, { push });
}

async function renderDecks() {
  const decks = await DB.getDecks();
  const questions = await DB.getQuestions();

  let rows = '';
  for (const d of decks) {
    const qs = questions.filter(q => q.deckIds.includes(d.id));
    rows += `
      <div class="deck-row" data-id="${d.id}">
        <div class="meta">
          <h3>${esc(d.name)}</h3>
          <div class="count">${qs.length} otázek</div>
        </div>
        <div class="chev">›</div>
      </div>`;
  }

  const lastBackupAt = Number(localStorage.getItem('lastBackupAt') || 0);
  const daysSince = lastBackupAt ? (Date.now() - lastBackupAt) / 86400000 : Infinity;
  const showBackupReminder = questions.length > 0 && daysSince > 7;

  app.innerHTML = `
    ${showBackupReminder ? `
      <div class="note-box" style="border-left-color:var(--red);background:var(--red-soft);color:var(--red)">
        ⚠️ ${lastBackupAt ? `Poslední záloha je stará ${Math.floor(daysSince)} dní.` : 'Otázky ještě nemáš nikdy zálohované.'}
        Appka je ukládá jen v tomto telefonu/prohlížeči — doporučuju si teď udělat zálohu níže.
      </div>
    ` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" id="multiQuizBtn" ${decks.length < 2 ? 'disabled' : ''}>▶ Test z více balíčků</button>
      <button class="btn btn-secondary" id="newDeckBtn">+ Nový balíček</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" id="backupBtn">💾 Záloha otázek</button>
    </div>
    ${decks.length === 0 ? `
      <div class="empty">
        <h3>Zatím žádné balíčky</h3>
        <p>Vytvoř balíček a přidej do něj otázky přes záložku „Vyfotit“.</p>
      </div>` : `<div style="margin-top:6px">${rows}</div>`}
  `;

  const multiQuizBtn = document.getElementById('multiQuizBtn');
  if (multiQuizBtn) multiQuizBtn.onclick = () => openMultiDeckQuiz();

  document.getElementById('newDeckBtn').onclick = async () => {
    const name = prompt('Název nového balíčku:');
    if (name && name.trim()) {
      await DB.addDeck(name.trim());
      renderDecks();
    }
  };
  document.getElementById('backupBtn').onclick = () => openBackup();
  app.querySelectorAll('.deck-row').forEach(row => {
    row.onclick = () => openDeckDetail(row.dataset.id);
  });
}

async function openDeckDetail(deckId) {
  const deck = await DB.getDeck(deckId);
  if (!deck) return openDecks(false);
  show({
    title: deck.name,
    render: () => renderDeckDetail(deckId),
  });
}

let deckFilter = 'all';

async function renderDeckDetail(deckId) {
  const deck = await DB.getDeck(deckId);
  const all = await DB.getQuestionsByDeck(deckId);
  const filtered = deckFilter === 'all' ? all : all.filter(q => q.status === deckFilter);

  app.innerHTML = `
    <div class="btn-row">
      <button class="btn btn-primary" id="quizBtn" ${all.length === 0 ? 'disabled' : ''}>▶ Spustit kvíz</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" id="renameBtn">Přejmenovat</button>
      <button class="btn btn-danger btn-sm" id="deleteDeckBtn">Smazat balíček</button>
    </div>
    <div class="section-label">Otázky (${all.length})</div>
    <div class="chips">
      ${chip('all', 'Vše', deckFilter)}
      ${chip('new', 'Nové', deckFilter)}
      ${chip('priority', 'Priorita', deckFilter)}
      ${chip('learned', 'Naučené', deckFilter)}
    </div>
    <div id="qlist">${renderQuestionRows(filtered)}</div>
  `;

  wireFilterChips(f => { deckFilter = f; renderDeckDetail(deckId); });
  wireQuestionRows();

  document.getElementById('quizBtn').onclick = () => openQuiz(deckId);
  document.getElementById('renameBtn').onclick = async () => {
    const name = prompt('Nový název balíčku:', deck.name);
    if (name && name.trim()) {
      await DB.renameDeck(deckId, name.trim());
      openDeckDetail(deckId);
    }
  };
  document.getElementById('deleteDeckBtn').onclick = async () => {
    if (confirm(`Smazat balíček „${deck.name}“? Otázky samotné zůstanou uložené.`)) {
      await DB.deleteDeck(deckId);
      goBack();
    }
  };
}

function chip(value, label, activeValue) {
  return `<button class="chip ${value === activeValue ? 'active' : ''}" data-value="${value}">${label}</button>`;
}
function wireFilterChips(onPick) {
  app.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => onPick(c.dataset.value);
  });
}

function renderQuestionRows(list) {
  if (list.length === 0) return `<div class="empty">Žádné otázky v tomto filtru.</div>`;
  return list.map(q => `
    <div class="q-row status-${q.status}" data-id="${q.id}">
      <div class="qtext">${esc(q.text) || '(bez textu)'}</div>
      ${badge(q.status)}
    </div>
  `).join('');
}
function badge(status) {
  if (status === 'priority') return `<span class="badge badge-priority">Priorita</span>`;
  if (status === 'learned') return `<span class="badge badge-learned">Naučeno</span>`;
  return `<span class="badge badge-new">Nové</span>`;
}
function wireQuestionRows() {
  app.querySelectorAll('.q-row').forEach(row => {
    row.onclick = () => openEditQuestion(row.dataset.id);
  });
}

/* ---------------- VŠECHNY OTÁZKY ---------------- */

let allFilter = 'all';

async function openAllQuestions(push = true) {
  show({ title: 'Všechny otázky', tab: 'all', render: renderAllQuestions }, { push });
}

async function renderAllQuestions() {
  const all = await DB.getQuestions();
  const filtered = allFilter === 'all' ? all : all.filter(q => q.status === allFilter);

  app.innerHTML = `
    <div class="chips">
      ${chip('all', 'Vše', allFilter)}
      ${chip('new', 'Nové', allFilter)}
      ${chip('priority', 'Priorita', allFilter)}
      ${chip('learned', 'Naučené', allFilter)}
    </div>
    ${all.length === 0 ? `
      <div class="empty">
        <h3>Žádné otázky</h3>
        <p>Přidej první otázku přes záložku „Vyfotit“.</p>
      </div>` : renderQuestionRows(filtered)}
  `;
  wireFilterChips(f => { allFilter = f; renderAllQuestions(); });
  wireQuestionRows();
}

/* ---------------- ÚPRAVA OTÁZKY ---------------- */

async function openEditQuestion(qId) {
  show({ title: 'Upravit otázku', render: () => renderEditQuestion(qId) });
}

async function renderEditQuestion(qId) {
  const q = await DB.getQuestion(qId);
  const decks = await DB.getDecks();
  if (!q) return goBack();

  app.innerHTML = `
    <div class="field">
      <label>Text otázky</label>
      <textarea id="qtext">${esc(q.text)}</textarea>
    </div>
    <div id="qImageWrap"></div>

    <div class="section-label">Odpovědi (klepni na kolečko = správná odpověď)</div>
    <div id="optList"></div>
    <button class="btn btn-secondary btn-sm" id="addOptBtn">+ Přidat možnost</button>

    <div class="field">
      <label>Poznámka (nepovinné — zobrazí se až po zodpovězení v kvízu)</label>
      <textarea id="qnote" placeholder="Např. vysvětlení, proč je odpověď správně, nebo mnemotechnická pomůcka…">${esc(q.note || '')}</textarea>
    </div>

    <div class="section-label">Balíčky</div>
    <div class="deck-picker" id="deckPicker"></div>

    <div class="section-label">Stav</div>
    <div class="mark-row">
      <button class="mark-btn ${q.status === 'priority' ? 'on priority' : ''}" id="markPriority">★ Priorita</button>
      <button class="mark-btn ${q.status === 'learned' ? 'on learned' : ''}" id="markLearned">✓ Naučeno</button>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn">Uložit</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-danger" id="deleteBtn">Smazat otázku</button>
    </div>
  `;

  let questionImage = q.image || '';
  function drawQImage() {
    const wrap = document.getElementById('qImageWrap');
    wrap.innerHTML = questionImage
      ? `<div class="formula-preview"><img src="${questionImage}"><button class="iconbtn" id="delQImageBtn" style="color:var(--red)">✕ Odebrat obrázek</button></div>`
      : `<button class="btn btn-secondary btn-sm" id="addQImageBtn">🧪 Vložit obrázek vzorce/schématu k otázce</button>`;
    const addBtn = document.getElementById('addQImageBtn');
    if (addBtn) addBtn.onclick = async () => {
      const img = await pickNewPhotoThenCrop();
      if (img) { questionImage = img; drawQImage(); }
    };
    const delBtn = document.getElementById('delQImageBtn');
    if (delBtn) delBtn.onclick = () => { questionImage = ''; drawQImage(); };
  }
  drawQImage();

  let options = q.options.map(o => ({ ...o }));
  const optList = document.getElementById('optList');
  function drawOptions() {
    optList.innerHTML = options.map((o, i) => `
      <div class="opt-edit ${o.correct ? 'marked-correct' : ''}" data-i="${i}">
        <button class="correct-toggle" data-i="${i}">${o.correct ? '✓' : ''}</button>
        <div style="flex:1">
          ${o.image ? `<div class="formula-preview small"><img src="${o.image}"><button class="iconbtn del-opt-img" data-i="${i}" style="color:var(--red)">✕</button></div>` : ''}
          <textarea data-i="${i}" placeholder="${o.image ? '(volitelný text k obrázku)' : ''}">${esc(o.text)}</textarea>
          ${!o.image ? `<button class="btn btn-ghost btn-sm" id="addOptImg-${i}" data-i="${i}">🧪 vzorec místo textu</button>` : ''}
        </div>
        <button class="iconbtn del-opt" data-i="${i}" style="color:var(--red)">✕</button>
      </div>
    `).join('');
    optList.querySelectorAll('.correct-toggle').forEach(b => {
      b.onclick = () => { options[b.dataset.i].correct = !options[b.dataset.i].correct; drawOptions(); };
    });
    optList.querySelectorAll('textarea').forEach(t => {
      t.oninput = () => { options[t.dataset.i].text = t.value; };
    });
    optList.querySelectorAll('.del-opt').forEach(b => {
      b.onclick = () => { options.splice(b.dataset.i, 1); drawOptions(); };
    });
    optList.querySelectorAll('.del-opt-img').forEach(b => {
      b.onclick = () => { options[b.dataset.i].image = ''; drawOptions(); };
    });
    options.forEach((o, i) => {
      const btn = document.getElementById(`addOptImg-${i}`);
      if (btn) btn.onclick = async () => {
        const img = await pickNewPhotoThenCrop();
        if (img) { options[i].image = img; drawOptions(); }
      };
    });
  }
  drawOptions();

  document.getElementById('addOptBtn').onclick = () => {
    options.push({ text: '', correct: false });
    drawOptions();
  };

  let selectedDecks = new Set(q.deckIds);
  const deckPicker = document.getElementById('deckPicker');
  function drawDecks() {
    deckPicker.innerHTML = decks.map(d => `
      <button class="deck-pick-chip ${selectedDecks.has(d.id) ? 'on' : ''}" data-id="${d.id}">${esc(d.name)}</button>
    `).join('') + `<button class="deck-pick-chip" id="newDeckInline">+ Nový</button>`;
    deckPicker.querySelectorAll('.deck-pick-chip[data-id]').forEach(c => {
      c.onclick = () => {
        const id = c.dataset.id;
        if (selectedDecks.has(id)) selectedDecks.delete(id); else selectedDecks.add(id);
        drawDecks();
      };
    });
    const nb = document.getElementById('newDeckInline');
    if (nb) nb.onclick = async () => {
      const name = prompt('Název nového balíčku:');
      if (name && name.trim()) {
        const d = await DB.addDeck(name.trim());
        decks.push(d);
        selectedDecks.add(d.id);
        drawDecks();
      }
    };
  }
  drawDecks();

  let status = q.status;
  document.getElementById('markPriority').onclick = () => {
    status = status === 'priority' ? 'new' : 'priority';
    renderStatusButtons();
  };
  document.getElementById('markLearned').onclick = () => {
    status = status === 'learned' ? 'new' : 'learned';
    renderStatusButtons();
  };
  function renderStatusButtons() {
    document.getElementById('markPriority').className = 'mark-btn' + (status === 'priority' ? ' on priority' : '');
    document.getElementById('markLearned').className = 'mark-btn' + (status === 'learned' ? ' on learned' : '');
  }

  document.getElementById('saveBtn').onclick = async () => {
    q.text = document.getElementById('qtext').value.trim();
    q.options = options.filter(o => o.text.trim().length > 0 || o.image);
    q.deckIds = Array.from(selectedDecks);
    q.note = document.getElementById('qnote').value.trim();
    q.image = questionImage;
    q.status = status;
    await DB.updateQuestion(q);
    toast('Uloženo');
    goBack();
  };
  document.getElementById('deleteBtn').onclick = async () => {
    if (confirm('Opravdu smazat tuto otázku?')) {
      await DB.deleteQuestion(qId);
      goBack();
    }
  };
}

/* ---------------- ZÁLOHA ---------------- */

async function openBackup() {
  show({ title: 'Záloha otázek', render: renderBackup });
}

async function renderBackup() {
  const decks = await DB.getDecks();
  const questions = await DB.getQuestions();

  app.innerHTML = `
    <div class="hint-box">
      Záloha uloží všechny balíčky a otázky (včetně obrázků vzorců) do
      jednoho souboru, který si můžeš uložit kamkoliv (Google Drive,
      e-mail sám sobě, počítač) — nezávisle na telefonu nebo appce.
      Kdyby appka přestala fungovat nebo bys měnil telefon, tímhle
      souborem otázky obnovíš.
    </div>
    <div class="section-label">Aktuálně v appce</div>
    <p style="color:var(--ink-soft);font-size:14px;margin-top:0">
      ${decks.length} balíčků, ${questions.length} otázek
    </p>
    <div class="btn-row">
      <button class="btn btn-primary" id="exportBtn">⬇️ Stáhnout zálohu</button>
    </div>

    <div class="section-label" style="margin-top:24px">Obnovit ze zálohy</div>
    <p style="color:var(--ink-soft);font-size:13px;margin-top:0">
      Přidá balíčky a otázky ze souboru zálohy do appky. Nic stávajícího
      nesmaže.
    </p>
    <input type="file" id="importInput" accept="application/json,.json">
    <div class="btn-row">
      <button class="btn btn-secondary" id="importBtn">⬆️ Vybrat soubor zálohy</button>
    </div>
  `;

  document.getElementById('exportBtn').onclick = async () => {
    const data = await DB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `prijimacky-zaloha-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Záloha stažena');
    localStorage.setItem('lastBackupAt', String(Date.now()));
  };

  document.getElementById('importBtn').onclick = () => {
    document.getElementById('importInput').click();
  };
  document.getElementById('importInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await DB.importAll(data);
      toast(`Obnoveno: ${result.decks} balíčků, ${result.questions} otázek`);
      renderBackup();
    } catch (err) {
      console.error(err);
      toast('Soubor zálohy se nepodařilo načíst — je to platný soubor zálohy?');
    }
  };
}

/* ---------------- FOCENÍ + OCR ---------------- */

let captureState = null;

async function openCapture(push = true) {
  captureState = { photos: [], blocks: null, index: 0, savedCount: 0 };
  show({ title: 'Vyfotit otázky', tab: 'capture', render: renderCapture }, { push });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderCapture() {
  const photos = captureState.photos;

  app.innerHTML = `
    <div class="hint-box">
      Vyfoť nebo vyber jednu i víc fotek stránek z učebnice. Klidně víc
      stránek najednou — appka je zpracuje popořadě. Po přepisu textu si
      u každé otázky ověříš a případně opravíš, které možnosti jsou
      správně (aplikace tučné písmo jen odhaduje).
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="takePhotoBtn">📷 Vyfotit</button>
      <button class="btn btn-secondary" id="pickGalleryBtn">🖼 Vybrat z galerie</button>
    </div>
    <input type="file" id="cameraInput" accept="image/*" capture="environment">
    <input type="file" id="galleryInput" accept="image/*" multiple>

    ${photos.length > 0 ? `
      <div class="section-label">Vybrané fotky (${photos.length})</div>
      <div class="thumb-grid" id="thumbGrid">
        ${photos.map((p, i) => `
          <div class="thumb" data-i="${i}">
            <img src="${p}">
            <button class="thumb-del" data-i="${i}">✕</button>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty">Zatím žádná fotka nevybrána.</div>`}

    <div class="btn-row">
      <button class="btn btn-primary" id="runOcrBtn" ${photos.length ? '' : 'disabled'}>
        Pokračovat${photos.length > 1 ? ` (${photos.length} fotek)` : ''}
      </button>
    </div>
  `;

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      captureState.photos.push(await readFileAsDataUrl(file));
    }
    renderCapture();
  }

  document.getElementById('takePhotoBtn').onclick = () => document.getElementById('cameraInput').click();
  document.getElementById('pickGalleryBtn').onclick = () => document.getElementById('galleryInput').click();
  document.getElementById('cameraInput').onchange = (e) => addFiles(e.target.files);
  document.getElementById('galleryInput').onchange = (e) => addFiles(e.target.files);

  app.querySelectorAll('.thumb-del').forEach(b => {
    b.onclick = () => {
      captureState.photos.splice(Number(b.dataset.i), 1);
      renderCapture();
    };
  });

  document.getElementById('runOcrBtn').onclick = () => startCropFlow();
}

/* --- Ořez fotky před OCR: výrazně zlepšuje přesnost, protože OCR
   pak nemusí ignorovat okraje stránky, prsty na fotce apod. --- */

function rotateImage90(src) {
  return OCR.loadImage(src).then(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return canvas.toDataURL('image/jpeg', 0.92);
  });
}

function imageToCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

/* Ořízne A ZÁROVEŇ narovná čtyřúhelník (může mít i nepravé úhly —
   typicky když je fotka pořízená z boku/pod úhlem) do rovného
   obdélníkového obrázku. quadPct = {tl,tr,br,bl} v procentech
   zobrazené fotky. */
async function warpImageByQuad(src, quadPct) {
  const img = await OCR.loadImage(src);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const toPx = (p) => ({ x: (p.x / 100) * nw, y: (p.y / 100) * nh });
  const quadPx = [toPx(quadPct.tl), toPx(quadPct.tr), toPx(quadPct.br), toPx(quadPct.bl)];
  const { w, h } = Geometry.outputSizeFromQuad(quadPx);
  const srcCanvas = imageToCanvas(img);
  const outCanvas = Geometry.warpQuadToRect(srcCanvas, quadPx, w, h);
  return outCanvas.toDataURL('image/jpeg', 0.95);
}

/* --- Vložení obrázku (vzorec/schéma) místo textu ---
   Používá se, když OCR nemá šanci smysluplně přečíst kreslený
   chemický vzorec nebo strukturní diagram — appka místo pokusu
   o přepis nabídne vystřižení dané oblasti fotky jako obrázku,
   který se pak zobrazí přímo u otázky nebo možnosti. */

function pickImageCrop(photoSrc) {
  return new Promise((resolve) => {
    show({ title: 'Výřez obrázku', render: () => renderImagePicker(photoSrc, resolve) });
  });
}

function renderImagePicker(photoSrc, resolve) {
  let rect = { left: 15, top: 15, width: 70, height: 40 };

  app.innerHTML = `
    <div class="hint-box">Přetáhni rohy přesně na obrázek (vzorec, schéma), který chceš vložit místo textu.</div>
    <div class="crop-wrap" id="cropWrap">
      <img id="cropImg" src="${photoSrc}" draggable="false">
      <div class="mark-rect" id="cropRect">
        <div class="crop-handle" data-corner="nw"></div>
        <div class="crop-handle" data-corner="ne"></div>
        <div class="crop-handle" data-corner="sw"></div>
        <div class="crop-handle" data-corner="se"></div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="confirmPickBtn">Použít výřez</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="cancelPickBtn">Zrušit</button>
    </div>
  `;

  const wrap = document.getElementById('cropWrap');
  const rectEl = document.getElementById('cropRect');

  function layout() {
    rectEl.style.left = rect.left + '%';
    rectEl.style.top = rect.top + '%';
    rectEl.style.width = rect.width + '%';
    rectEl.style.height = rect.height + '%';
  }
  layout();

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  let drag = null;
  function onPointerDown(e, mode, corner) {
    e.preventDefault();
    const wrapRect = wrap.getBoundingClientRect();
    drag = { mode, corner, startX: e.clientX, startY: e.clientY, startRect: { ...rect }, wrapW: wrapRect.width, wrapH: wrapRect.height };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }
  function onPointerMove(e) {
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startX) / drag.wrapW) * 100;
    const dyPct = ((e.clientY - drag.startY) / drag.wrapH) * 100;
    const sr = drag.startRect;
    const MIN = 6;
    if (drag.mode === 'move') {
      rect.left = clamp(sr.left + dxPct, 0, 100 - sr.width);
      rect.top = clamp(sr.top + dyPct, 0, 100 - sr.height);
    } else {
      let { left, top, width, height } = sr;
      if (drag.corner.includes('w')) {
        const newLeft = clamp(sr.left + dxPct, 0, sr.left + sr.width - MIN);
        width = sr.width - (newLeft - sr.left);
        left = newLeft;
      }
      if (drag.corner.includes('e')) width = clamp(sr.width + dxPct, MIN, 100 - sr.left);
      if (drag.corner.includes('n')) {
        const newTop = clamp(sr.top + dyPct, 0, sr.top + sr.height - MIN);
        height = sr.height - (newTop - sr.top);
        top = newTop;
      }
      if (drag.corner.includes('s')) height = clamp(sr.height + dyPct, MIN, 100 - sr.top);
      rect = { left, top, width, height };
    }
    layout();
  }
  function onPointerUp() {
    drag = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  rectEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('crop-handle')) return;
    onPointerDown(e, 'move');
  });
  rectEl.querySelectorAll('.crop-handle').forEach(h => {
    h.addEventListener('pointerdown', (e) => { e.stopPropagation(); onPointerDown(e, 'resize', h.dataset.corner); });
  });

  document.getElementById('confirmPickBtn').onclick = async () => {
    const img = await OCR.loadImage(photoSrc);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const x = Math.round((rect.left / 100) * nw);
    const y = Math.round((rect.top / 100) * nh);
    const w = Math.max(1, Math.round((rect.width / 100) * nw));
    const h = Math.max(1, Math.round((rect.height / 100) * nh));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    goBack();
    resolve(dataUrl);
  };
  document.getElementById('cancelPickBtn').onclick = () => {
    goBack();
    resolve(null);
  };
}

/* Pro editaci uložené otázky (mimo focení) už není k dispozici zdrojová
   fotka ze session — necháme uživatele nejdřív vybrat/vyfotit novou. */
function pickNewPhotoThenCrop() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) { resolve(null); return; }
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await pickImageCrop(dataUrl);
      resolve(cropped);
    };
    input.click();
  });
}

function startCropFlow() {
  captureState.cropIndex = 0;
  captureState.working = captureState.photos.slice();
  captureState.cropped = [];
  captureState.imageRegions = [];
  show({ title: `Ořez 1 / ${captureState.working.length}`, render: renderCropStep });
}

const DEFAULT_QUAD = () => ({
  tl: { x: 8, y: 8 }, tr: { x: 92, y: 8 },
  br: { x: 92, y: 92 }, bl: { x: 8, y: 92 },
});

function renderCropStep() {
  const i = captureState.cropIndex;
  const total = captureState.working.length;
  pageTitle.textContent = `Ořez fotky ${i + 1} / ${total}`;

  let quad = DEFAULT_QUAD();

  app.innerHTML = `
    <div class="hint-box">
      Přetáhni 4 rohy přesně na rohy oblasti s otázkou/otázkami — klidně
      i našikmo, pokud je fotka pořízená z boku nebo pod úhlem. Appka
      oblast narovná, než ji pošle do OCR.
    </div>
    <div class="crop-wrap" id="cropWrap">
      <img id="cropImg" src="${captureState.working[i]}" draggable="false">
      <svg class="crop-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon id="cropPoly" class="crop-poly"></polygon>
      </svg>
      <div class="crop-handle" data-corner="tl"></div>
      <div class="crop-handle" data-corner="tr"></div>
      <div class="crop-handle" data-corner="br"></div>
      <div class="crop-handle" data-corner="bl"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" id="rotateBtn">⟳ Otočit o 90°</button>
      <button class="btn btn-ghost btn-sm" id="resetCropBtn">Celá fotka</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="applyCropBtn">${i < total - 1 ? 'Narovnat a další fotka' : 'Narovnat a rozpoznat text'}</button>
    </div>
  `;

  const wrap = document.getElementById('cropWrap');
  const poly = document.getElementById('cropPoly');
  const handles = {};
  ['tl', 'tr', 'br', 'bl'].forEach(c => {
    handles[c] = wrap.querySelector(`.crop-handle[data-corner="${c}"]`);
  });

  function layout() {
    for (const c of ['tl', 'tr', 'br', 'bl']) {
      handles[c].style.left = quad[c].x + '%';
      handles[c].style.top = quad[c].y + '%';
    }
    poly.setAttribute('points', ['tl', 'tr', 'br', 'bl'].map(c => `${quad[c].x},${quad[c].y}`).join(' '));
  }
  layout();

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  let drag = null;
  function onPointerDown(e, corner) {
    e.preventDefault();
    const wrapRect = wrap.getBoundingClientRect();
    drag = { corner, startX: e.clientX, startY: e.clientY, startPt: { ...quad[corner] }, wrapW: wrapRect.width, wrapH: wrapRect.height };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }
  function onPointerMove(e) {
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startX) / drag.wrapW) * 100;
    const dyPct = ((e.clientY - drag.startY) / drag.wrapH) * 100;
    quad[drag.corner] = {
      x: clamp(drag.startPt.x + dxPct, 0, 100),
      y: clamp(drag.startPt.y + dyPct, 0, 100),
    };
    layout();
  }
  function onPointerUp() {
    drag = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  Object.entries(handles).forEach(([corner, el]) => {
    el.addEventListener('pointerdown', (e) => onPointerDown(e, corner));
  });

  document.getElementById('resetCropBtn').onclick = () => {
    quad = DEFAULT_QUAD();
    layout();
  };

  document.getElementById('rotateBtn').onclick = async () => {
    const rotated = await rotateImage90(captureState.working[i]);
    captureState.working[i] = rotated;
    renderCropStep();
  };

  document.getElementById('applyCropBtn').onclick = async () => {
    const btn = document.getElementById('applyCropBtn');
    btn.disabled = true;
    btn.textContent = 'Narovnávám…';
    const warped = await warpImageByQuad(captureState.working[i], quad);
    captureState.cropped.push(warped);
    show({ title: `Obrázky ve fotce ${i + 1} / ${total}`, render: () => renderMarkImagesStep(i, total) });
  };
}

/* --- Označení oblastí, které se mají vložit jako obrázek (ne text) ---
   Krok hned po narovnání fotky. Uživatel může označit 0 a víc oblastí
   (typicky chemický vzorec/schéma mezi zadáním otázky a odpověďmi) —
   appka je z OCR vynechá a po rozpoznání textu je automaticky přiřadí
   k otázce, do jejíhož textového rozsahu na stránce spadají. */

function renderMarkImagesStep(photoIndex, total) {
  const photoSrc = captureState.cropped[photoIndex];
  captureState.imageRegions = captureState.imageRegions || [];
  let rects = (captureState.imageRegions[photoIndex] || []).slice();

  app.innerHTML = `
    <div class="hint-box">
      Pokud je na fotce nakreslený chemický vzorec nebo schéma (např. u
      otázek typu „Sloučenina s tímto vzorcem se nazývá“), označ ho
      obdélníkem — appka ho nebude přepisovat jako text, ale vloží jako
      obrázek přímo k otázce. Nic označit nemusíš, pokud fotka žádný
      vzorec neobsahuje.
    </div>
    <div class="crop-wrap" id="markWrap">
      <img src="${photoSrc}" draggable="false">
      <div id="rectsLayer"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" id="addRectBtn">+ Označit oblast s obrázkem</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="continueBtn">${photoIndex < total - 1 ? 'Pokračovat na další fotku' : 'Pokračovat a rozpoznat text'}</button>
    </div>
  `;

  const wrap = document.getElementById('markWrap');
  const layer = document.getElementById('rectsLayer');

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function drawRects() {
    layer.innerHTML = rects.map((r, idx) => `
      <div class="mark-rect" data-i="${idx}" style="left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%">
        <button class="mark-rect-del" data-i="${idx}">✕</button>
        <div class="crop-handle" data-i="${idx}" data-corner="nw"></div>
        <div class="crop-handle" data-i="${idx}" data-corner="ne"></div>
        <div class="crop-handle" data-i="${idx}" data-corner="sw"></div>
        <div class="crop-handle" data-i="${idx}" data-corner="se"></div>
      </div>
    `).join('');

    layer.querySelectorAll('.mark-rect').forEach(el => {
      el.addEventListener('pointerdown', (e) => {
        if (e.target !== el) return; // handles/delete mají vlastní listener
        startDrag(e, Number(el.dataset.i), 'move');
      });
    });
    layer.querySelectorAll('.mark-rect-del').forEach(b => {
      b.onclick = () => { rects.splice(Number(b.dataset.i), 1); drawRects(); };
    });
    layer.querySelectorAll('.crop-handle').forEach(h => {
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        startDrag(e, Number(h.dataset.i), 'resize', h.dataset.corner);
      });
    });
  }

  let drag = null;
  function startDrag(e, idx, mode, corner) {
    e.preventDefault();
    const wrapRect = wrap.getBoundingClientRect();
    drag = { idx, mode, corner, startX: e.clientX, startY: e.clientY, startRect: { ...rects[idx] }, wrapW: wrapRect.width, wrapH: wrapRect.height };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function onMove(e) {
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startX) / drag.wrapW) * 100;
    const dyPct = ((e.clientY - drag.startY) / drag.wrapH) * 100;
    const sr = drag.startRect;
    const MIN = 4;
    let r;
    if (drag.mode === 'move') {
      r = {
        left: clamp(sr.left + dxPct, 0, 100 - sr.width),
        top: clamp(sr.top + dyPct, 0, 100 - sr.height),
        width: sr.width, height: sr.height,
      };
    } else {
      let { left, top, width, height } = sr;
      if (drag.corner.includes('w')) {
        const newLeft = clamp(sr.left + dxPct, 0, sr.left + sr.width - MIN);
        width = sr.width - (newLeft - sr.left); left = newLeft;
      }
      if (drag.corner.includes('e')) width = clamp(sr.width + dxPct, MIN, 100 - sr.left);
      if (drag.corner.includes('n')) {
        const newTop = clamp(sr.top + dyPct, 0, sr.top + sr.height - MIN);
        height = sr.height - (newTop - sr.top); top = newTop;
      }
      if (drag.corner.includes('s')) height = clamp(sr.height + dyPct, MIN, 100 - sr.top);
      r = { left, top, width, height };
    }
    rects[drag.idx] = r;
    const el = layer.querySelector(`.mark-rect[data-i="${drag.idx}"]`);
    el.style.left = r.left + '%'; el.style.top = r.top + '%';
    el.style.width = r.width + '%'; el.style.height = r.height + '%';
  }
  function onUp() {
    drag = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }

  drawRects();

  document.getElementById('addRectBtn').onclick = () => {
    rects.push({ left: 25, top: 30, width: 50, height: 25 });
    drawRects();
  };

  document.getElementById('continueBtn').onclick = () => {
    captureState.imageRegions[photoIndex] = rects;
    if (photoIndex < total - 1) {
      captureState.cropIndex = photoIndex + 1;
      renderCropStep();
    } else {
      runOcrOnPhotos(captureState.cropped);
    }
  };
}

/* Namaskuje označené oblasti bílou barvou na kopii fotky, aby je OCR
   vůbec nezkoušel číst jako text — originál (pro pozdější výřez
   obrázku) zůstává nedotčený v captureState.cropped. */
async function maskRegionsForOcr(photoSrc, regions) {
  if (!regions || regions.length === 0) return photoSrc;
  const img = await OCR.loadImage(photoSrc);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '#ffffff';
  for (const r of regions) {
    ctx.fillRect(
      (r.left / 100) * canvas.width, (r.top / 100) * canvas.height,
      (r.width / 100) * canvas.width, (r.height / 100) * canvas.height
    );
  }
  return canvas.toDataURL('image/jpeg', 0.95);
}

/* Vystřihne skutečný obsah (nezamaskovaný) dané oblasti pro vložení
   jako obrázek k otázce. */
async function cropRegion(photoSrc, r) {
  const img = await OCR.loadImage(photoSrc);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const x = Math.round((r.left / 100) * nw);
  const y = Math.round((r.top / 100) * nh);
  const w = Math.max(1, Math.round((r.width / 100) * nw));
  const h = Math.max(1, Math.round((r.height / 100) * nh));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/* Najde blok, do jehož textového rozsahu na stránce (yTop..yBottom v %)
   označená oblast spadá — nebo ten nejbližší, pokud přesně nesedí
   (např. vzorec těsně pod poslední možností na fotce). */
function assignRegionToBlock(regionCenterPct, blocks) {
  let best = null, bestDist = Infinity;
  for (const b of blocks) {
    if (b.yTop == null || b.yBottom == null) continue;
    if (regionCenterPct >= b.yTop && regionCenterPct <= b.yBottom) return b;
    const dist = regionCenterPct < b.yTop ? b.yTop - regionCenterPct : regionCenterPct - b.yBottom;
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best;
}

function runOcrOnPhotos(photosArr) {
  show({ title: 'Rozpoznávání textu', render: () => renderOcrProgress(photosArr) });
}

function renderOcrProgress(photosArr) {
  app.innerHTML = `
    <div class="hint-box">Rozpoznávám text z fotky/fotek. U víc fotek to chvíli trvá.</div>
    <div class="progress"><div id="progressBar"></div></div>
    <div class="quiz-progress" id="progressLabel">Připravuji…</div>
  `;
  processPhotos(photosArr);
}

async function processPhotos(photosArr) {
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const allBlocks = [];
  const rawTexts = [];
  const regionsPerPhoto = captureState.imageRegions || [];
  try {
    for (let p = 0; p < photosArr.length; p++) {
      progressLabel.textContent = `Fotka ${p + 1} / ${photosArr.length} — rozpoznávám text…`;
      const regions = regionsPerPhoto[p] || [];
      // Označené oblasti (vzorce/schémata) se z OCR úplně vynechají —
      // appka je vůbec nezkouší přepisovat jako text.
      const ocrSrc = await maskRegionsForOcr(photosArr[p], regions);
      const { lines, rawText } = await OCR.recognize(ocrSrc, (progress) => {
        const overall = (p + progress) / photosArr.length;
        progressBar.style.width = Math.round(overall * 100) + '%';
      });
      rawTexts.push(rawText);
      const blocks = Parser.buildQuestionsFromOcrLines(lines).filter(
        b => b.question || b.options.length > 0
      );
      blocks.forEach(b => { b.photoIndex = p; });

      // Každou označenou oblast přiřadíme k nejbližší otázce podle
      // pozice na stránce a rovnou z ní vystřihneme skutečný obrázek
      // (z NEzamaskované fotky).
      for (const r of regions) {
        const centerPct = r.top + r.height / 2;
        const target = assignRegionToBlock(centerPct, blocks);
        if (target) {
          target.questionImage = await cropRegion(photosArr[p], r);
        }
      }

      allBlocks.push(...blocks);
    }
    if (allBlocks.length === 0) {
      toast('Nepodařilo se rozpoznat žádnou otázku, zkus to znovu s přesnějším ořezem.');
      goBack();
      return;
    }
    captureState.rawTexts = rawTexts;
    captureState.blocks = allBlocks.map(b => ({
      question: b.question,
      options: b.options.map(o => ({ text: o.text, correct: !!o.suggestedCorrect })),
      deckIds: new Set(),
      note: '',
      confidence: b.confidence,
      photoIndex: b.photoIndex,
      questionImage: b.questionImage || '',
    }));
    captureState.index = 0;
    navStack = [];
    show({ title: `Otázka 1 / ${captureState.blocks.length}`, render: renderCaptureConfirm }, { push: false });
  } catch (err) {
    console.error(err);
    toast('Chyba při rozpoznávání textu.');
    goBack();
  }
}

async function renderCaptureConfirm() {
  const decks = await DB.getDecks();
  const i = captureState.index;
  const block = captureState.blocks[i];
  pageTitle.textContent = `Otázka ${i + 1} / ${captureState.blocks.length}`;

  const conf = block.confidence;
  let confLabel = 'vysoká', confClass = 'conf-high';
  if (conf < 60) { confLabel = 'nízká — pozorně zkontroluj text'; confClass = 'conf-low'; }
  else if (conf < 80) { confLabel = 'střední'; confClass = 'conf-mid'; }

  app.innerHTML = `
    <div class="conf-badge ${confClass}">Jistota rozpoznání textu: ${confLabel} (${Math.round(conf)} %)</div>
    <button class="btn btn-ghost btn-sm" id="rawToggleBtn" style="margin-bottom:10px">📄 Zobrazit syrový přepis fotky (pro kontrolu)</button>
    <div id="rawTextBox" class="raw-text-box" hidden>${esc((captureState.rawTexts || [])[block.photoIndex] || '(není k dispozici)')}</div>

    <div class="field">
      <label>Text otázky</label>
      <textarea id="qtext">${esc(block.question)}</textarea>
    </div>
    <div id="qImageWrap"></div>

    <div class="section-label">Odpovědi — klepni na kolečko = správná</div>
    <div id="optList"></div>
    <button class="btn btn-secondary btn-sm" id="addOptBtn">+ Přidat možnost</button>

    <div class="field">
      <label>Poznámka (nepovinné — zobrazí se až po zodpovězení v kvízu)</label>
      <textarea id="qnote" placeholder="Např. vysvětlení, proč je odpověď správně…">${esc(block.note || '')}</textarea>
    </div>

    <div class="section-label">Balíček</div>
    <div class="deck-picker" id="deckPicker"></div>

    <div class="btn-row">
      <button class="btn btn-primary" id="saveNextBtn">
        ${i < captureState.blocks.length - 1 ? 'Uložit a další otázka' : 'Uložit a dokončit'}
      </button>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="skipBtn">Přeskočit tuto otázku</button>
    </div>
  `;

  function drawQImage() {
    const wrap = document.getElementById('qImageWrap');
    wrap.innerHTML = block.questionImage
      ? `<div class="formula-preview"><img src="${block.questionImage}"><button class="iconbtn" id="delQImageBtn" style="color:var(--red)">✕ Odebrat obrázek</button></div>`
      : `<button class="btn btn-secondary btn-sm" id="addQImageBtn">🧪 Vložit obrázek vzorce/schématu k otázce</button>`;
    const addBtn = document.getElementById('addQImageBtn');
    if (addBtn) addBtn.onclick = async () => {
      const src = captureState.cropped[block.photoIndex];
      const img = await pickImageCrop(src);
      if (img) block.questionImage = img;
      renderCaptureConfirm();
    };
    const delBtn = document.getElementById('delQImageBtn');
    if (delBtn) delBtn.onclick = () => { block.questionImage = ''; drawQImage(); };
  }
  drawQImage();

  function drawOptions() {
    document.getElementById('optList').innerHTML = block.options.map((o, idx) => `
      <div class="opt-edit ${o.correct ? 'marked-correct' : ''}" data-i="${idx}">
        <button class="correct-toggle" data-i="${idx}">${o.correct ? '✓' : ''}</button>
        <div style="flex:1">
          ${o.image ? `<div class="formula-preview small"><img src="${o.image}"><button class="iconbtn del-opt-img" data-i="${idx}" style="color:var(--red)">✕</button></div>` : ''}
          <textarea data-i="${idx}" placeholder="${o.image ? '(volitelný text k obrázku)' : ''}">${esc(o.text)}</textarea>
          ${!o.image ? `<button class="btn btn-ghost btn-sm" id="addOptImg-${idx}" data-i="${idx}">🧪 vzorec místo textu</button>` : ''}
        </div>
        <button class="iconbtn del-opt" data-i="${idx}" style="color:var(--red)">✕</button>
      </div>
    `).join('');
    document.querySelectorAll('.correct-toggle').forEach(b => {
      b.onclick = () => { block.options[b.dataset.i].correct = !block.options[b.dataset.i].correct; drawOptions(); };
    });
    document.querySelectorAll('#optList textarea').forEach(t => {
      t.oninput = () => { block.options[t.dataset.i].text = t.value; };
    });
    document.querySelectorAll('.del-opt').forEach(b => {
      b.onclick = () => { block.options.splice(b.dataset.i, 1); drawOptions(); };
    });
    document.querySelectorAll('.del-opt-img').forEach(b => {
      b.onclick = () => { block.options[b.dataset.i].image = ''; drawOptions(); };
    });
    block.options.forEach((o, idx) => {
      const btn = document.getElementById(`addOptImg-${idx}`);
      if (btn) btn.onclick = async () => {
        const src = captureState.cropped[block.photoIndex];
        const img = await pickImageCrop(src);
        if (img) block.options[idx].image = img;
        drawOptions();
      };
    });
  }
  drawOptions();

  document.getElementById('addOptBtn').onclick = () => {
    block.options.push({ text: '', correct: false });
    drawOptions();
  };
  document.getElementById('qtext').oninput = (e) => { block.question = e.target.value; };
  document.getElementById('qnote').oninput = (e) => { block.note = e.target.value; };
  document.getElementById('rawToggleBtn').onclick = () => {
    const box = document.getElementById('rawTextBox');
    box.hidden = !box.hidden;
  };

  function drawDecks() {
    document.getElementById('deckPicker').innerHTML = decks.map(d => `
      <button class="deck-pick-chip ${block.deckIds.has(d.id) ? 'on' : ''}" data-id="${d.id}">${esc(d.name)}</button>
    `).join('') + `<button class="deck-pick-chip" id="newDeckInline">+ Nový</button>`;
    document.querySelectorAll('.deck-pick-chip[data-id]').forEach(c => {
      c.onclick = () => {
        const id = c.dataset.id;
        if (block.deckIds.has(id)) block.deckIds.delete(id); else block.deckIds.add(id);
        drawDecks();
      };
    });
    const nb = document.getElementById('newDeckInline');
    if (nb) nb.onclick = async () => {
      const name = prompt('Název nového balíčku:');
      if (name && name.trim()) {
        const d = await DB.addDeck(name.trim());
        decks.push(d);
        block.deckIds.add(d.id);
        drawDecks();
      }
    };
  }
  drawDecks();

  async function saveBlock() {
    const text = document.getElementById('qtext').value.trim();
    const opts = block.options.filter(o => o.text.trim().length > 0 || o.image);
    if ((!text && !block.questionImage) || opts.length < 2) {
      toast('Otázka potřebuje text (nebo obrázek) a alespoň 2 možnosti.');
      return false;
    }
    await DB.addQuestion({
      text, options: opts, deckIds: Array.from(block.deckIds),
      note: (block.note || '').trim(), image: block.questionImage || '',
    });
    captureState.savedCount++;
    return true;
  }

  document.getElementById('saveNextBtn').onclick = async () => {
    const ok = await saveBlock();
    if (!ok) return;
    advance();
  };
  document.getElementById('skipBtn').onclick = () => advance();

  function advance() {
    if (i < captureState.blocks.length - 1) {
      captureState.index++;
      renderCaptureConfirm();
    } else {
      toast(`Uloženo otázek: ${captureState.savedCount}`);
      navStack = [];
      openDecks(false);
    }
  }
}

/* ---------------- KVÍZ ---------------- */

let quizState = null;

async function openQuiz(deckId) {
  show({ title: 'Kvíz', render: () => renderQuizSetup(deckId) });
}

async function openMultiDeckQuiz() {
  show({ title: 'Test z více balíčků', render: renderMultiDeckQuizSetup });
}

async function renderMultiDeckQuizSetup() {
  const decks = await DB.getDecks();
  const questions = await DB.getQuestions();
  const usableByDeck = new Map();

  for (const deck of decks) {
    const usable = questions.filter(q =>
      q.deckIds && q.deckIds.includes(deck.id) &&
      q.options && q.options.some(o => o.correct) && q.options.length >= 2
    );
    usableByDeck.set(deck.id, usable);
  }

  app.innerHTML = `
    <div class="hint-box">Vyber jeden nebo více balíčků, ze kterých chceš vytvořit společný test.</div>
    <div id="multiDeckList">
      ${decks.map(d => {
        const count = usableByDeck.get(d.id).length;
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px">
            <input type="checkbox" class="multideckchk" data-deck-id="${esc(d.id)}" ${count === 0 ? 'disabled' : ''} style="width:20px;height:20px">
            <span style="flex:1">${esc(d.name)}</span>
            <span class="count">${count} otázek</span>
          </label>`;
      }).join('')}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="multiStartBtn">▶ Pokračovat</button>
    </div>
  `;

  document.getElementById('multiStartBtn').onclick = () => {
    const selectedDeckIds = Array.from(document.querySelectorAll('.multideckchk:checked'))
      .map(c => c.dataset.deckId);
    if (selectedDeckIds.length === 0) {
      toast('Vyber alespoň jeden balíček.');
      return;
    }
    renderMultiDeckQuizOptions(selectedDeckIds, usableByDeck);
  };
}

function renderMultiDeckQuizOptions(selectedDeckIds, usableByDeck) {
  const usable = [];
  const seen = new Set();
  for (const deckId of selectedDeckIds) {
    for (const q of usableByDeck.get(deckId) || []) {
      // Otázka může být ve více vybraných balíčcích; v testu ji chceme jen jednou.
      if (!seen.has(q.id)) {
        seen.add(q.id);
        usable.push(q);
      }
    }
  }

  const counts = {
    new: usable.filter(q => q.status === 'new').length,
    priority: usable.filter(q => q.status === 'priority').length,
    learned: usable.filter(q => q.status === 'learned').length,
  };

  app.innerHTML = `
    <div class="hint-box">Vybrané balíčky: <strong>${selectedDeckIds.length}</strong> · použitelných otázek: <strong>${usable.length}</strong></div>
    <div id="incList">
      ${quizCheckbox('new', `Nové (${counts.new})`, true)}
      ${quizCheckbox('priority', `Priorita (${counts.priority})`, true)}
      ${quizCheckbox('learned', `Naučené (${counts.learned})`, false)}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="multiStartFinalBtn">▶ Spustit test</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" id="backToMultiDecksBtn">← Zpět k výběru balíčků</button>
    </div>
  `;

  document.getElementById('backToMultiDecksBtn').onclick = () => renderMultiDeckQuizSetup();
  document.getElementById('multiStartFinalBtn').onclick = () => {
    const included = Array.from(document.querySelectorAll('.incchk'))
      .filter(c => c.checked).map(c => c.dataset.status);
    let pool = usable.filter(q => included.includes(q.status));
    if (pool.length === 0) {
      toast('Žádné otázky k procvičení podle tohoto výběru.');
      return;
    }
    pool = pool.flatMap(q => q.status === 'priority' ? [q, q] : [q]);
    shuffle(pool);
    quizState = { pool, i: 0, correctCount: 0, total: pool.length, answered: false, selected: new Set() };
    show({ title: 'Kvíz', render: renderQuizQuestion });
  };
}

async function renderQuizSetup(deckId) {
  const all = await DB.getQuestionsByDeck(deckId);
  const usable = all.filter(q => q.options.some(o => o.correct) && q.options.length >= 2);

  const counts = {
    new: usable.filter(q => q.status === 'new').length,
    priority: usable.filter(q => q.status === 'priority').length,
    learned: usable.filter(q => q.status === 'learned').length,
  };

  app.innerHTML = `
    <div class="hint-box">Vyber, které otázky se mají v kvízu objevit. Prioritní otázky se v kvízu objeví o něco častěji.</div>
    <div id="incList">
      ${quizCheckbox('new', `Nové (${counts.new})`, true)}
      ${quizCheckbox('priority', `Priorita (${counts.priority})`, true)}
      ${quizCheckbox('learned', `Naučené (${counts.learned})`, false)}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="startBtn">▶ Spustit kvíz</button>
    </div>
  `;

  document.getElementById('startBtn').onclick = () => {
    const included = Array.from(document.querySelectorAll('.incchk'))
      .filter(c => c.checked).map(c => c.dataset.status);
    let pool = usable.filter(q => included.includes(q.status));
    if (pool.length === 0) { toast('Žádné otázky k procvičení podle tohoto výběru.'); return; }
    // prioritní otázky se objeví 2x
    pool = pool.flatMap(q => q.status === 'priority' ? [q, q] : [q]);
    shuffle(pool);
    quizState = { pool, i: 0, correctCount: 0, total: pool.length, answered: false, selected: new Set() };
    show({ title: 'Kvíz', render: renderQuizQuestion });
  };
}

function quizCheckbox(status, label, checked) {
  return `
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0;font-size:15px">
      <input type="checkbox" class="incchk" data-status="${status}" ${checked ? 'checked' : ''} style="width:20px;height:20px">
      ${label}
    </label>`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderQuizQuestion() {
  if (quizState.i >= quizState.total) return renderQuizResult();
  const q = quizState.pool[quizState.i];
  const opts = q._shuffledOpts || (q._shuffledOpts = shuffle(q.options.map((o, idx) => ({ ...o, idx }))));
  quizState.answered = false;
  quizState.selected = new Set();
  pageTitle.textContent = 'Kvíz';

  app.innerHTML = `
    <div class="quiz-progress">Otázka ${quizState.i + 1} / ${quizState.total}</div>
    <div class="quiz-question">${esc(q.text)}</div>
    ${q.image ? `<div class="formula-preview"><img src="${q.image}"></div>` : ''}
    <div id="optsWrap">
      ${opts.map((o, k) => `
        <button class="quiz-opt" data-k="${k}">
          ${o.image ? `<img class="quiz-opt-img" src="${o.image}">` : ''}
          ${o.text ? esc(o.text) : ''}
        </button>
      `).join('')}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="submitBtn" disabled>Vyhodnotit</button>
    </div>
    <div id="afterAnswer"></div>
  `;

  document.querySelectorAll('.quiz-opt').forEach(btn => {
    btn.onclick = () => {
      if (quizState.answered) return;
      const k = btn.dataset.k;
      if (quizState.selected.has(k)) quizState.selected.delete(k); else quizState.selected.add(k);
      btn.classList.toggle('selected');
      document.getElementById('submitBtn').disabled = quizState.selected.size === 0;
    };
  });

  document.getElementById('submitBtn').onclick = () => {
    quizState.answered = true;
    const correctIdx = new Set(opts.map((o, k) => o.correct ? k : null).filter(k => k !== null).map(String));
    const isCorrect = correctIdx.size === quizState.selected.size &&
      Array.from(correctIdx).every(k => quizState.selected.has(k));
    if (isCorrect) quizState.correctCount++;

    document.querySelectorAll('.quiz-opt').forEach((btn, k) => {
      const key = String(k);
      if (correctIdx.has(key)) btn.classList.add('correct-reveal');
      else if (quizState.selected.has(key)) btn.classList.add('wrong-reveal');
    });
    document.getElementById('submitBtn').disabled = true;

    document.getElementById('afterAnswer').innerHTML = `
      <div class="hint-box" style="background:${isCorrect ? 'var(--green-soft)' : 'var(--red-soft)'};color:${isCorrect ? 'var(--green)' : 'var(--red)'}">
        ${isCorrect ? 'Správně!' : 'Bohužel špatně.'}
      </div>
      ${q.note ? `<div class="note-box">💡 ${esc(q.note)}</div>` : ''}
      <div class="mark-row">
        <button class="mark-btn ${q.status === 'priority' ? 'on priority' : ''}" id="qMarkPriority">★ Priorita</button>
        <button class="mark-btn ${q.status === 'learned' ? 'on learned' : ''}" id="qMarkLearned">✓ Naučeno</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" id="editInlineBtn">✎ Upravit otázku</button>
      </div>
      <div id="inlineEditWrap"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="nextBtn">${quizState.i + 1 < quizState.total ? 'Další otázka' : 'Zobrazit výsledek'}</button>
      </div>
    `;

    document.getElementById('qMarkPriority').onclick = async () => {
      q.status = q.status === 'priority' ? 'new' : 'priority';
      await DB.updateQuestion(q);
      renderMarkButtons();
    };
    document.getElementById('qMarkLearned').onclick = async () => {
      q.status = q.status === 'learned' ? 'new' : 'learned';
      await DB.updateQuestion(q);
      renderMarkButtons();
    };
    function renderMarkButtons() {
      document.getElementById('qMarkPriority').className = 'mark-btn' + (q.status === 'priority' ? ' on priority' : '');
      document.getElementById('qMarkLearned').className = 'mark-btn' + (q.status === 'learned' ? ' on learned' : '');
    }

    document.getElementById('editInlineBtn').onclick = () => {
      const wrap = document.getElementById('inlineEditWrap');
      if (wrap.dataset.open === '1') {
        wrap.innerHTML = '';
        wrap.dataset.open = '0';
        return;
      }
      wrap.dataset.open = '1';
      let editOptions = q.options.map(o => ({ ...o }));
      function drawInlineOptions() {
        document.getElementById('inlineOptList').innerHTML = editOptions.map((o, k) => `
          <div class="opt-edit ${o.correct ? 'marked-correct' : ''}" data-k="${k}">
            <button class="correct-toggle" data-k="${k}">${o.correct ? '✓' : ''}</button>
            <textarea data-k="${k}">${esc(o.text)}</textarea>
          </div>
        `).join('');
        document.querySelectorAll('#inlineOptList .correct-toggle').forEach(b => {
          b.onclick = () => { editOptions[b.dataset.k].correct = !editOptions[b.dataset.k].correct; drawInlineOptions(); };
        });
        document.querySelectorAll('#inlineOptList textarea').forEach(t => {
          t.oninput = () => { editOptions[t.dataset.k].text = t.value; };
        });
      }
      wrap.innerHTML = `
        <div class="field">
          <label>Text otázky</label>
          <textarea id="inlineQtext">${esc(q.text)}</textarea>
        </div>
        <div class="section-label">Odpovědi (klepni na kolečko = správná)</div>
        <div id="inlineOptList"></div>
        <div class="field">
          <label>Poznámka</label>
          <textarea id="inlineQnote">${esc(q.note || '')}</textarea>
        </div>
        <div class="hint-box">Oprava se projeví hned v datech. Zvýraznění správně/špatně u téhle už zodpovězené otázky na obrazovce zůstane beze změny — je to jen kosmetika aktuálního zobrazení.</div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" id="inlineSaveBtn">Uložit opravu</button>
        </div>
      `;
      drawInlineOptions();
      document.getElementById('inlineSaveBtn').onclick = async () => {
        q.text = document.getElementById('inlineQtext').value.trim();
        q.note = document.getElementById('inlineQnote').value.trim();
        q.options = editOptions.filter(o => o.text.trim().length > 0).map(o => ({ text: o.text.trim(), correct: !!o.correct }));
        await DB.updateQuestion(q);
        toast('Otázka opravena');
        wrap.innerHTML = '';
        wrap.dataset.open = '0';
      };
    };

    document.getElementById('nextBtn').onclick = () => {
      quizState.i++;
      renderQuizQuestion();
    };
  };
}

function renderQuizResult() {
  pageTitle.textContent = 'Výsledek';
  const pct = Math.round((quizState.correctCount / quizState.total) * 100);
  app.innerHTML = `
    <div class="quiz-result">
      <div class="big">${quizState.correctCount} / ${quizState.total}</div>
      <p>${pct}% správně</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="doneBtn">Hotovo</button>
      </div>
    </div>
  `;
  document.getElementById('doneBtn').onclick = () => {
    navStack = [];
    openDecks(false);
  };
}

/* Vestavěné otázky (viz seed-data.js) se přidávají po DÁVKÁCH —
   každá dávka (např. biologie, fyzika, později třeba chemie) se do
   appky vloží PŘESNĚ JEDNOU, bez ohledu na to, kdy appku uživatel
   nainstaloval. Díky tomu, když appku aktualizuješ a přidáš novou
   dávku otázek, appka ji doplní i uživatelům, kteří appku mají už
   dávno nainstalovanou — a NEOPAKUJE dávky, které už jednou proběhly
   (ani kdyby si uživatel jejich otázky mezitím sám smazal). */
async function seedBuiltInQuestionsIfNeeded() {
  let done;
  try {
    done = JSON.parse(localStorage.getItem('seededBatches') || '[]');
  } catch (e) {
    done = [];
  }
  // Zpetna kompatibilita se starsi verzi appky (mela jen jednu davku
  // otazek z biologie pod prostym priznakem "seedDone").
  if (localStorage.getItem('seedDone') && !done.includes('biology-2lf-v1')) {
    done.push('biology-2lf-v1');
  }

  if (typeof SEED_BATCHES === 'undefined') return;
  let changed = false;
  for (const batch of SEED_BATCHES) {
    if (done.includes(batch.id)) continue;
    try {
      await DB.importAll({ decks: batch.decks, questions: batch.questions });
      // Dávku označíme jako hotovou AŽ po úspěšném importu.
      // Pokud import selže (např. kvůli úložišti), při dalším
      // spuštění se dávka zkusí znovu místo toho, aby se přeskočila.
      done.push(batch.id);
      changed = true;
    } catch (err) {
      console.error('Seedovani davky selhalo:', batch.id, err);
    }
  }
  if (changed) {
    localStorage.setItem('seededBatches', JSON.stringify(done));
    localStorage.setItem('seedDone', '1');
  }
}

/* ---------------- START ---------------- */

seedBuiltInQuestionsIfNeeded().then(() => openDecks(false)).catch((err) => {
  console.error('Inicializace vestavěných otázek selhala:', err);
  openDecks(false);
  toast('Vestavěné otázky se nepodařilo načíst. Zkus aplikaci restartovat.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* Požádáme prohlížeč o "trvalé" úložiště — bez tohohle může Android/
   Chrome při nedostatku místa data appky (uložené otázky) tiše smazat
   bez varování. S tímhle požadavkem je mnohem méně pravděpodobné, že
   k tomu dojde. Nejde vynutit ani ověřit stoprocentně (rozhoduje
   prohlížeč), ale je to bezpečnostní opatření zdarma. */
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
