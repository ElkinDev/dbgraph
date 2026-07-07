/*
 * dbgraph viz — client viewer. Vanilla JS + the vendored global `d3` force modules.
 * Reads the embedded data block from #dbgraph-data only; it never touches the network.
 * The live force animation is intentionally NOT deterministic and NOT goldened (ADR-008);
 * only the embedded data block / community assignment / mermaid text are pinned server-side.
 */
(function () {
  'use strict';

  var raw = document.getElementById('dbgraph-data');
  var data;
  try {
    data = JSON.parse(raw ? raw.textContent : '{}');
  } catch (err) {
    void err;
    data = { nodes: [], edges: [], communities: [] };
  }
  var nodes = (data.nodes || []).map(function (n) {
    return {
      i: n.i, label: n.label, kind: n.kind, community: n.community,
      degree: n.degree || 0, detail: n.detail || '',
      schema: (String(n.label).indexOf('.') >= 0 ? String(n.label).split('.')[0] : '')
    };
  });
  var edges = (data.edges || []).map(function (e) { return { source: e.s, target: e.t, kind: e.kind }; });
  var communities = data.communities || [];

  // ── Color palette (community id → hue), fallback by kind when no communities ────────
  var PALETTE = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf',
    '#ff7b72', '#7ee787', '#ffa657', '#a5d6ff', '#d2a8ff', '#56d364'
  ];
  function colorForCommunity(id) { return PALETTE[((id % PALETTE.length) + PALETTE.length) % PALETTE.length]; }
  var kindColors = {};
  var kindsSeen = [];
  nodes.forEach(function (n) { if (kindsSeen.indexOf(n.kind) < 0) kindsSeen.push(n.kind); });
  kindsSeen.sort();
  kindsSeen.forEach(function (k, idx) { kindColors[k] = PALETTE[idx % PALETTE.length]; });
  var hasCommunities = communities.length > 0;
  function nodeColor(n) { return hasCommunities ? colorForCommunity(n.community) : kindColors[n.kind]; }

  // ── Filter state ────────────────────────────────────────────────────────────────────
  var state = {
    search: '',
    minDegree: 0,
    hiddenCommunities: {},
    hiddenKinds: {},
    hiddenSchemas: {}
  };

  function schemasOf() {
    var seen = [];
    nodes.forEach(function (n) { if (n.schema && seen.indexOf(n.schema) < 0) seen.push(n.schema); });
    return seen.sort();
  }

  function visible(n) {
    if (state.hiddenCommunities[n.community]) return false;
    if (state.hiddenKinds[n.kind]) return false;
    if (n.schema && state.hiddenSchemas[n.schema]) return false;
    if (n.degree < state.minDegree) return false;
    if (state.search && String(n.label).toLowerCase().indexOf(state.search) < 0) return false;
    return true;
  }

  // ── Canvas + transform (pan/zoom) ─────────────────────────────────────────────────────
  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var transform = { x: 0, y: 0, k: 1 };

  function resize() {
    var rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    if (!started) center();
  }
  window.addEventListener('resize', resize);

  function center() {
    transform.x = canvas.width / (2 * dpr);
    transform.y = canvas.height / (2 * dpr);
    transform.k = 1;
  }

  // ── Force simulation (vendored d3) ────────────────────────────────────────────────────
  var started = false;
  if (window.d3 && typeof window.d3.forceSimulation === 'function') {
    window.d3.forceSimulation(nodes)
      .force('charge', window.d3.forceManyBody().strength(-120))
      .force('link', window.d3.forceLink(edges).id(function (d) { return d.i; }).distance(60).strength(0.4))
      .force('x', window.d3.forceX(0).strength(0.03))
      .force('y', window.d3.forceY(0).strength(0.03))
      .force('collide', window.d3.forceCollide(10))
      .on('tick', draw);
    started = true;
  }

  function draw() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // edges
    ctx.strokeStyle = 'rgba(139,148,158,0.25)';
    ctx.lineWidth = 1 / transform.k;
    ctx.beginPath();
    edges.forEach(function (e) {
      var s = e.source, t = e.target;
      if (!s || !t || !visible(s) || !visible(t)) return;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
    });
    ctx.stroke();

    // nodes
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var r = 4 + Math.min(6, n.degree * 0.6);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(n);
      ctx.fill();
      if (n === selected) {
        ctx.lineWidth = 2 / transform.k;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  // ── Interaction: pan, zoom, click hit-test ───────────────────────────────────────────
  var dragging = false, dragMoved = false, last = null;
  canvas.addEventListener('mousedown', function (ev) {
    dragging = true; dragMoved = false; last = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('grabbing');
  });
  window.addEventListener('mouseup', function (ev) {
    if (dragging && !dragMoved) handleClick(ev);
    dragging = false; canvas.classList.remove('grabbing');
  });
  window.addEventListener('mousemove', function (ev) {
    if (!dragging) return;
    var dx = ev.clientX - last.x, dy = ev.clientY - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
    transform.x += dx; transform.y += dy;
    last = { x: ev.clientX, y: ev.clientY };
    draw();
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    var wx = (mx - transform.x) / transform.k, wy = (my - transform.y) / transform.k;
    transform.k = Math.max(0.1, Math.min(8, transform.k * factor));
    transform.x = mx - wx * transform.k;
    transform.y = my - wy * transform.k;
    draw();
  }, { passive: false });

  function handleClick(ev) {
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var wx = (mx - transform.x) / transform.k, wy = (my - transform.y) / transform.k;
    var hit = null, hitDist = 12 * 12;
    nodes.forEach(function (n) {
      if (!visible(n) || n.x === undefined) return;
      var d = (n.x - wx) * (n.x - wx) + (n.y - wy) * (n.y - wy);
      if (d < hitDist) { hitDist = d; hit = n; }
    });
    if (hit) openDetail(hit); else closeDetail();
  }

  // ── Detail panel (shows the server-rendered formatObject text — NO client renderer) ──
  var selected = null;
  var detail = document.getElementById('detail');
  var detailTitle = document.getElementById('detail-title');
  var detailBody = document.getElementById('detail-body');
  function openDetail(n) {
    selected = n;
    detailTitle.textContent = n.label;
    detailBody.textContent = n.detail;
    detail.setAttribute('aria-hidden', 'false');
    draw();
  }
  function closeDetail() {
    selected = null;
    detail.setAttribute('aria-hidden', 'true');
    draw();
  }
  document.getElementById('detail-close').addEventListener('click', closeDetail);

  // ── Sidebar wiring ────────────────────────────────────────────────────────────────────
  function makeLegendItem(listId, key, label, count, color, hiddenMap) {
    var li = document.createElement('li');
    var sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = color;
    var lb = document.createElement('span'); lb.className = 'label'; lb.textContent = label;
    var ct = document.createElement('span'); ct.className = 'count'; ct.textContent = String(count);
    li.appendChild(sw); li.appendChild(lb); li.appendChild(ct);
    li.addEventListener('click', function () {
      if (hiddenMap[key]) { delete hiddenMap[key]; li.classList.remove('off'); }
      else { hiddenMap[key] = true; li.classList.add('off'); }
      draw();
    });
    document.getElementById(listId).appendChild(li);
  }

  function countBy(pred) { var c = 0; nodes.forEach(function (n) { if (pred(n)) c++; }); return c; }

  (function buildSidebar() {
    if (hasCommunities) {
      communities.forEach(function (c) {
        makeLegendItem('community-list', c.id, c.name, c.count, colorForCommunity(c.id), state.hiddenCommunities);
      });
    } else {
      var li = document.createElement('li'); li.className = 'muted';
      li.textContent = 'none — colored by kind';
      document.getElementById('community-list').appendChild(li);
    }
    kindsSeen.forEach(function (k) {
      makeLegendItem('kind-list', k, k, countBy(function (n) { return n.kind === k; }), kindColors[k], state.hiddenKinds);
    });
    var schemas = schemasOf();
    if (schemas.length === 0) {
      var s = document.createElement('li'); s.className = 'muted'; s.textContent = 'none';
      document.getElementById('schema-list').appendChild(s);
    } else {
      schemas.forEach(function (sc) {
        makeLegendItem('schema-list', sc, sc, countBy(function (n) { return n.schema === sc; }), '#8b949e', state.hiddenSchemas);
      });
    }
    var maxDeg = 0; nodes.forEach(function (n) { if (n.degree > maxDeg) maxDeg = n.degree; });
    var slider = document.getElementById('min-degree');
    slider.max = String(Math.max(1, maxDeg));
    var stats = document.getElementById('stats');
    stats.textContent = nodes.length + ' nodes · ' + edges.length + ' edges';
  })();

  document.getElementById('search').addEventListener('input', function (ev) {
    state.search = String(ev.target.value || '').toLowerCase();
    draw();
  });
  var mdOut = document.getElementById('min-degree-out');
  document.getElementById('min-degree').addEventListener('input', function (ev) {
    state.minDegree = parseInt(ev.target.value, 10) || 0;
    mdOut.textContent = String(state.minDegree);
    draw();
  });

  // ── Boot ──────────────────────────────────────────────────────────────────────────────
  resize();
  center();
  if (!started) draw();
})();
