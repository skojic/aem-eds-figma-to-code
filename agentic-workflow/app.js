/* =============================================================
   Figma → Code — Agentic Workflow
   Vanilla JS, no build step.
   ============================================================= */

const $ = (sel) => document.querySelector(sel);

const state = {
  files: true,
  diagram: true,
  prompt: true,
  stage: 0,
  selected: null,
  fill: 30,
  // shared layers: 'off' | 'base' | 'ext'
  layers: { config: 'ext', gates: 'ext', mcp: 'ext', subagents: 'ext', model: 'ext' },
};

const MODES = [
  { id: 'off', label: 'off' },
  { id: 'base', label: 'base' },
  { id: 'ext', label: 'ext' },
];

function make(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ---------- control deck ------------------------------------ */
function renderControls() {
  const view = $('#row-view');
  const layers = $('#row-layers');
  view.innerHTML = '';
  layers.innerHTML = '';

  const chip = (label, kind, on, toggle, hint) => {
    const b = make('button', 'chip-btn');
    b.type = 'button';
    b.dataset.kind = kind;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `<i></i>${label}`;
    b.addEventListener('click', toggle);
    bindHint(b, hint);
    return b;
  };

  view.append(
    chip('Files', 'context', state.files, () => {
      state.files = !state.files;
      if (!state.files && !state.diagram) state.diagram = true;
      render();
    }, 'Show the project file tree — what exists on disk at each stage.'),
    chip('Diagram', 'tool', state.diagram, () => {
      state.diagram = !state.diagram;
      if (!state.diagram && !state.files) state.files = true;
      render();
    }, 'Show the three-phase workflow board.'),
    chip('Prompt', 'step', state.prompt, () => {
      state.prompt = !state.prompt;
      render();
    }, 'The slash-command invocation itself. These skills are explicit-invocation only.'),
  );

  LAYERS.forEach((meta) => {
    const row = make('div', 'seg-row');
    row.dataset.kind = meta.kind;
    if (state.layers[meta.id] !== 'off') row.classList.add('is-on');

    const label = make('span', 'seg-row__label');
    label.innerHTML = `<i></i>${meta.label}`;

    const seg = make('div', 'seg');
    MODES.forEach((m) => {
      const b = make('button', null, m.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.layers[meta.id] === m.id));
      b.addEventListener('click', () => { state.layers[meta.id] = m.id; render(); });
      bindHint(b, `${meta.label} — ${meta.hint}`);
      seg.append(b);
    });

    row.append(label, seg);
    layers.append(row);
  });

  $('#controls-hint').textContent = defaultHint();
}

let hintTimer;
function bindHint(node, hint) {
  if (!hint) return;
  const show = () => { clearTimeout(hintTimer); $('#controls-hint').textContent = hint; };
  const clear = () => { hintTimer = setTimeout(() => { $('#controls-hint').textContent = defaultHint(); }, 150); };
  node.addEventListener('mouseenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('mouseleave', clear);
  node.addEventListener('blur', clear);
}

function defaultHint() {
  const n = (v) => Object.values(state.layers).filter((x) => x === v).length;
  return `${n('ext')} ext · ${n('base')} base · ${n('off')} off — base draws the headline path, ext expands every MCP call, gate and subagent.`;
}

/* ---------- stage track ------------------------------------- */
function renderTrack() {
  const el = $('#stepper');
  el.innerHTML = '';
  STAGES.forEach((s) => {
    const b = make('button', 'tick');
    b.type = 'button';
    if (s.n < state.stage) b.classList.add('is-done');
    if (s.n === state.stage) b.classList.add('is-current');
    b.innerHTML = `<span>${s.n}</span><span>${s.label}</span>`;
    b.addEventListener('click', () => { state.stage = s.n; state.selected = null; render(); });
    el.append(b);
  });
  $('#stepper-caption').textContent = STAGES[state.stage].caption;
}

/* ---------- file tree --------------------------------------- */
function buildTree(files) {
  const root = { name: '', children: new Map(), file: null };
  files.forEach((f) => {
    let node = root;
    f.path.split('/').forEach((part, i, parts) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map(), file: null });
      node = node.children.get(part);
      if (i === parts.length - 1) node.file = f;
    });
  });
  return root;
}

function renderTree() {
  const host = $('#tree');
  host.innerHTML = '';
  const root = buildTree(FILES.filter((f) => f.stage <= state.stage));

  const walk = (node, depth) => {
    [...node.children.values()]
      .sort((a, b) => (!!a.file === !!b.file ? a.name.localeCompare(b.name) : a.file ? 1 : -1))
      .forEach((child) => {
        const isFile = !!child.file;
        const row = make('div', `tree__row ${isFile ? 'tree__row--file' : 'tree__row--dir'}`);
        row.style.paddingLeft = `${8 + depth * 13}px`;
        if (isFile) {
          row.dataset.status = child.file.status;
          if (child.file.stage === state.stage && state.stage > 0) row.classList.add('is-new');
          if (state.selected === child.file.path) row.classList.add('is-active');
          row.tabIndex = 0;
          const pick = () => { state.selected = child.file.path; render(); };
          row.addEventListener('click', pick);
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
          });
        }
        row.innerHTML = `<span class="tree__bullet"></span>
          <span class="tree__name">${esc(child.name)}${isFile ? '' : '/'}</span>
          ${isFile ? `<span class="tree__badge">${esc(child.file.status)}</span>` : ''}`;
        host.append(row);
        walk(child, depth + 1);
      });
  };
  walk(root, 0);
}

function renderDetail() {
  const host = $('#detail');
  const file = FILES.find((f) => f.path === state.selected);
  if (!file) {
    host.innerHTML = `<p class="detail__hint">Pick a file to see what it contributes to the loop — the diagram node it drives lights up on the board.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="detail__path">${esc(file.path)}</div>
    <span class="detail__badge">${esc(file.status)}</span>
    <h3>${esc(file.title)}</h3>
    <p>${esc(file.desc)}</p>
    <pre><code>${esc(file.code)}</code></pre>
    ${file.node ? '' : '<p class="detail__hint" style="margin-top:12px">Not part of the workflow board.</p>'}`;
}

/* ---------- board ------------------------------------------- */
function nodeVisible(n) {
  if (n.layer === 'prompt') return state.prompt;
  if (!n.layer) return true;
  const mode = state.layers[n.layer];
  if (mode === 'off') return false;
  if (n.mode === 'extended') return mode === 'ext';
  return true;
}

function linkedNode() {
  const f = FILES.find((x) => x.path === state.selected);
  return f && f.node;
}

function renderBoard() {
  const host = $('#flow');
  host.innerHTML = '';

  PHASES.forEach((phase) => {
    const lane = make('div', 'lane');
    lane.dataset.phase = phase.n;

    const head = make('div', 'lane__head');
    head.innerHTML = `<div class="lane__n">0${phase.n}</div>
      <div><div class="lane__title">${phase.title}</div>
      <div class="lane__sub">${phase.sub}</div></div>`;
    lane.append(head);

    const flow = make('div', 'lane__flow');
    const nodes = DIAGRAM.filter((n) => n.phase === phase.n && nodeVisible(n));

    if (!nodes.length) {
      flow.append(make('div', 'lane__empty', 'All layers in this phase are switched off.'));
    }

    nodes.forEach((n, i) => {
      if (i > 0) flow.append(make('div', 'hop'));
      flow.append(n.kind === 'payload' ? payloadNode() : basicNode(n, i + 1));
    });

    if (nodes.some((n) => n.id === 'verdict')) {
      flow.append(make('div', 'loopback', 'FAIL ⟲ back to phase 02 — fix, then re-validate'));
    }

    lane.append(flow);
    host.append(lane);
  });
}

const KIND_TAG = {
  gate: 'fail-stop', tool: 'mcp', subagent: 'subagent', model: 'model',
  human: 'you', output: 'artifact', verdict: 'verdict', step: 'invoke',
};

function basicNode(n, idx) {
  const box = make('div', 'node');
  box.dataset.kind = n.kind;
  box.dataset.node = n.id;
  if (linkedNode() === n.id) box.classList.add('is-linked');

  box.innerHTML = `
    <div class="node__head">
      <span class="node__num">${String(idx).padStart(2, '0')}</span>
      <span class="node__title">${esc(n.title)}</span>
      ${KIND_TAG[n.kind] ? `<span class="node__kind">${KIND_TAG[n.kind]}</span>` : ''}
    </div>
    ${n.sub ? `<div class="node__sub">${esc(n.sub)}</div>` : ''}`;

  const chips = (n.chips || []).filter((c) => c.mode !== 'extended' || state.layers[n.layer] === 'ext');
  if (chips.length) {
    const wrap = make('div', 'chips-row');
    chips.forEach((c) => wrap.append(make('span', 'chip', c.text)));
    box.append(wrap);
  }

  if (n.branches) {
    const wrap = make('div', 'branches');
    n.branches.forEach((b) => {
      const d = make('div', 'branch');
      d.dataset.tone = b.tone;
      d.innerHTML = `<b>${b.label}</b>${esc(b.text)}`;
      wrap.append(d);
    });
    box.append(wrap);
  }
  return box;
}

function payloadNode() {
  const box = make('div', 'payload');
  box.dataset.kind = 'payload';
  box.dataset.node = 'payload';
  if (linkedNode() === 'payload') box.classList.add('node', 'is-linked');

  const cfgOn = state.layers.config !== 'off' && state.stage >= 4;
  const tokensOn = state.layers.config === 'ext' && state.stage >= 4;
  const compacted = state.fill > COMPACT_AT;
  const historyPct = Math.min(100, Math.max(8, (state.fill / COMPACT_AT) * 100));

  const rows = [
    {
      k: 'skills[]',
      ...(state.stage >= 1
        ? { t: 'cached prefix', d: 'figma-specify · figma-screenshot · figma-validate', cls: 'pblock--cached' }
        : { t: 'empty', d: 'no skill pack installed', cls: 'pblock--empty' }),
    },
    {
      k: 'system[]',
      ...(cfgOn
        ? { t: 'cached prefix', d: `figma-to-code.config.md${tokensOn ? ' + token_files' : ''}`, cls: 'pblock--cached' }
        : { t: 'missing', d: 'skills fail-stop without config', cls: 'pblock--empty' }),
    },
    compacted
      ? { k: 'messages[]', t: '<summary> + recent turns', d: 'auto-compacted', cls: 'pblock--compact', bar: 24 }
      : { k: 'messages[]', t: 'history', d: 'prior turns, tool results, screenshots', bar: historyPct },
  ];

  box.innerHTML = `
    <div class="payload__title">Model request payload</div>
    <div class="payload__sub">cache order: skills → config → messages</div>
    ${rows.map((r) => `
      <div class="pblock ${r.cls || ''}">
        <div class="pblock__k">${esc(r.k)}</div>
        <div class="pblock__t">${esc(r.t)}</div>
        <div class="pblock__d">${esc(r.d)}</div>
        ${r.bar ? `<div class="grow" style="width:${r.bar}%"></div>` : ''}
      </div>`).join('')}`;
  return box;
}

/* ---------- radial gauge + composition ---------------------- */
const R = 56;
const CIRC = 2 * Math.PI * R;

function renderGauge() {
  const active = SEGMENTS.filter((s) => s.when({ ...state, layers: normalisedLayers() }));
  const fixed = active.reduce((sum, s) => sum + s.tokens, 0);
  const fixedPct = (fixed / BUDGET) * 100;
  const totalPct = Math.min(100, Math.max(state.fill, fixedPct));
  const compacted = totalPct > COMPACT_AT;

  $('#fill-value').textContent = `${Math.round(totalPct)}%`;
  $('#gauge-cap').textContent = `${((totalPct / 100) * BUDGET / 1000).toFixed(0)}K / 200K`;
  $('#fill').style.setProperty('--pct', `${state.fill}%`);

  const arc = $('#gauge-arc');
  arc.style.strokeDasharray = `${CIRC}`;
  arc.style.strokeDashoffset = `${CIRC * (1 - totalPct / 100)}`;
  $('.gauge').classList.toggle('is-over', compacted);
  $('#gauge-tick').style.transform = `rotate(${(COMPACT_AT / 100) * 360}deg)`;

  const list = $('#sim-legend');
  list.innerHTML = '';
  active.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name">${esc(s.label)}</span>
      <span class="tok">${(s.tokens / 1000).toFixed(1)}K${s.cached ? ' ·c' : ''}</span>
      <span class="meter"><i style="width:${Math.min(100, (s.tokens / BUDGET) * 100 * 4)}%;background:${tone(s.tone)}"></i></span>`;
    list.append(li);
  });

  const msgTokens = Math.max(0, ((totalPct - fixedPct) / 100) * BUDGET);
  const li = document.createElement('li');
  li.innerHTML = `<span class="name">conversation messages</span>
    <span class="tok">${(msgTokens / 1000).toFixed(1)}K</span>
    <span class="meter"><i style="width:${Math.min(100, (msgTokens / BUDGET) * 100 * 1.6)}%;background:#4d4c61"></i></span>`;
  list.append(li);

  const note = $('#sim-note');
  note.classList.toggle('is-warn', compacted);
  note.innerHTML = compacted
    ? `<strong>Auto-compacted.</strong> History collapses to a summary; the cached skills + config prefix survives untouched.`
    : `Fixed prefix ${(fixed / 1000).toFixed(1)}K. Auto-compaction fires at <strong>${COMPACT_AT}%</strong>.`;
}

/* SEGMENTS were written against 'extended'; map 'ext' onto it. */
function normalisedLayers() {
  const out = {};
  Object.entries(state.layers).forEach(([k, v]) => { out[k] = v === 'ext' ? 'extended' : v; });
  return out;
}

function tone(t) {
  return {
    neutral: '#4b5570', cyan: '#80ffea', purple: '#9580ff',
    green: '#8aff80', orange: '#ffca80', pink: '#ff80bf',
  }[t];
}

/* ---------- keys legend ------------------------------------- */
function renderKeys() {
  const host = $('#kind-legend');
  host.innerHTML = '';
  KIND_LEGEND.forEach((k) => {
    const li = document.createElement('li');
    li.dataset.kind = k.kind;
    li.innerHTML = `<i></i>${k.label}`;
    host.append(li);
  });
}

/* ---------- render / boot ----------------------------------- */
function render() {
  document.body.classList.toggle('is-files-off', !state.files);
  document.body.classList.toggle('is-diagram-off', !state.diagram);

  renderControls();
  renderTrack();
  renderTree();
  renderDetail();
  renderGauge();
  if (state.diagram) renderBoard();
}

function boot() {
  $('#fill').addEventListener('input', (e) => {
    state.fill = Number(e.target.value);
    renderGauge();
    if (state.diagram) renderBoard();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowRight' && state.stage < STAGES.length - 1) { state.stage += 1; render(); }
    if (e.key === 'ArrowLeft' && state.stage > 0) { state.stage -= 1; render(); }
  });

  renderKeys();
  render();
}

boot();
