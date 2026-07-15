// Any-Page Snake — content script
// Plays Snake on a full-page overlay: word ink (via Pretext) is blocked,
// gaps between words are walkable. Cabinet UI is score / controls HUD.

import { buildTextOccupancy, isBlocked } from "./textMap.js";

(() => {
  if (window.__anyPageSnakeInjected) return;
  window.__anyPageSnakeInjected = true;

  const HOST_ID = "any-page-snake-host";

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }

    .tab {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      width: 34px;
      height: 84px;
      background: linear-gradient(180deg, #3a3226, #241f18);
      border: 2px solid #8a7a52;
      border-right: none;
      border-radius: 10px 0 0 10px;
      box-shadow: -2px 2px 8px rgba(0,0,0,.4);
      cursor: pointer;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: width .15s ease;
      pointer-events: auto;
    }
    .tab:hover { width: 40px; }
    .tab svg { width: 20px; height: 20px; }

    .cabinet {
      position: fixed;
      top: 50%;
      right: 16px;
      transform: translateY(-50%) translateX(30px);
      opacity: 0;
      pointer-events: none;
      width: 280px;
      z-index: 2147483647;
      background: linear-gradient(160deg, #3a3226, #201b14);
      border: 3px solid #8a7a52;
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.04);
      transition: opacity .18s ease, transform .18s ease;
    }
    .cabinet.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }

    .marquee {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #e8dcc0;
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      padding: 0 2px 8px 2px;
      border-bottom: 1px solid rgba(232,220,192,.15);
      margin-bottom: 8px;
    }
    .marquee .title { color: #ffb347; text-shadow: 0 0 6px rgba(255,179,71,.6); }
    .marquee button {
      all: unset;
      cursor: pointer;
      color: #e8dcc0;
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .marquee button:hover { background: rgba(255,255,255,.08); }

    .hud {
      display: flex;
      justify-content: space-between;
      color: #ffb347;
      font-size: 12px;
      letter-spacing: .08em;
      text-shadow: 0 0 4px rgba(255,179,71,.5);
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .start-btn {
      all: unset;
      cursor: pointer;
      display: block;
      text-align: center;
      background: linear-gradient(180deg, #ffb347, #e08a1a);
      color: #1a140c;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: .14em;
      text-transform: uppercase;
      padding: 10px 12px;
      border-radius: 8px;
      box-shadow: 0 2px 0 #8a5a12, 0 4px 12px rgba(0,0,0,.35);
    }
    .start-btn:hover { filter: brightness(1.06); }
    .start-btn:active { transform: translateY(1px); box-shadow: 0 1px 0 #8a5a12; }
    .start-btn:disabled {
      cursor: default;
      opacity: 0.55;
      filter: none;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: #d8c9a0;
      font-size: 11px;
      letter-spacing: .04em;
    }
    .toggle-row .label { flex: 1; }
    .toggle-btn {
      all: unset;
      cursor: pointer;
      min-width: 44px;
      text-align: center;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(232,220,192,.25);
      font-size: 10px;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: #b8a878;
      background: rgba(0,0,0,.25);
    }
    .toggle-btn.on {
      color: #1a140c;
      background: #ffb347;
      border-color: #ffb347;
      font-weight: 700;
    }
    .toggle-btn:hover { filter: brightness(1.08); }
    .hint {
      color: #b8a878;
      font-size: 10.5px;
      text-align: center;
      margin-top: 8px;
      letter-spacing: .03em;
      line-height: 1.45;
    }
    .status {
      color: #d8c9a0;
      font-size: 11px;
      margin-top: 8px;
      text-align: center;
      min-height: 1.2em;
    }

    .playfield {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483645;
      pointer-events: none;
      display: none;
    }
    .playfield.active { display: block; }
  `;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <canvas class="playfield"></canvas>
    <div class="tab" title="Play Snake on this page">
      <svg viewBox="0 0 24 24" fill="none" stroke="#ffb347" stroke-width="2" stroke-linecap="round">
        <path d="M4 12c0-3 2-5 5-5s5 2 5 5-2 5-5 5" />
        <circle cx="17" cy="7" r="2" fill="#ffb347" stroke="none" />
      </svg>
    </div>
    <div class="cabinet">
      <div class="marquee">
        <span class="title">● page snake</span>
        <button class="close-btn" title="Close">✕</button>
      </div>
      <div class="hud">
        <span class="score">SCORE 000</span>
        <span class="best">BEST 000</span>
      </div>
      <div class="controls">
        <button class="start-btn" type="button">Start</button>
        <div class="toggle-row">
          <span class="label">Boundaries</span>
          <button class="toggle-btn boundaries-btn on" type="button" aria-pressed="true">ON</button>
        </div>
        <div class="toggle-row">
          <span class="label">Dim page</span>
          <button class="toggle-btn dim-btn" type="button" aria-pressed="false">OFF</button>
        </div>
      </div>
      <div class="status">hit START to begin</div>
      <div class="hint">navigate the gaps between words<br>arrows / wasd · p pause · esc quit</div>
    </div>
  `;
  root.appendChild(style);
  root.appendChild(wrapper);

  const tab = wrapper.querySelector(".tab");
  const cabinet = wrapper.querySelector(".cabinet");
  const closeBtn = wrapper.querySelector(".close-btn");
  const startBtn = wrapper.querySelector(".start-btn");
  const boundariesBtn = wrapper.querySelector(".boundaries-btn");
  const dimBtn = wrapper.querySelector(".dim-btn");
  const playfield = wrapper.querySelector(".playfield");
  const ctx = playfield.getContext("2d");
  const scoreEl = wrapper.querySelector(".score");
  const bestEl = wrapper.querySelector(".best");
  const statusEl = wrapper.querySelector(".status");

  let isOpen = false;
  let playing = false; // true after START until cabinet closes
  let showBoundaries = true;
  let dimPage = false;
  let best = 0;

  chrome.storage?.local?.get(
    ["anyPageSnakeBest", "anyPageSnakeBoundaries", "anyPageSnakeDim"],
    (res) => {
      best = res.anyPageSnakeBest || 0;
      bestEl.textContent = `BEST ${String(best).padStart(3, "0")}`;
      if (typeof res.anyPageSnakeBoundaries === "boolean") {
        showBoundaries = res.anyPageSnakeBoundaries;
        syncBoundariesButton();
      }
      if (typeof res.anyPageSnakeDim === "boolean") {
        dimPage = res.anyPageSnakeDim;
        syncDimButton();
      }
    }
  );

  function syncBoundariesButton() {
    boundariesBtn.classList.toggle("on", showBoundaries);
    boundariesBtn.textContent = showBoundaries ? "ON" : "OFF";
    boundariesBtn.setAttribute("aria-pressed", showBoundaries ? "true" : "false");
  }

  function syncDimButton() {
    dimBtn.classList.toggle("on", dimPage);
    dimBtn.textContent = dimPage ? "ON" : "OFF";
    dimBtn.setAttribute("aria-pressed", dimPage ? "true" : "false");
  }

  function syncStartButton() {
    if (!playing) {
      startBtn.textContent = "Start";
      startBtn.disabled = false;
    } else if (running) {
      startBtn.textContent = "Restart";
      startBtn.disabled = false;
    } else {
      startBtn.textContent = "Play again";
      startBtn.disabled = false;
    }
  }

  function setPlayfieldVisible(visible) {
    playfield.classList.toggle("active", visible);
  }

  function setOpen(open) {
    isOpen = open;
    cabinet.classList.toggle("open", open);
    if (open) {
      showLobby();
    } else {
      stopGame();
      setPlayfieldVisible(false);
    }
  }

  function showLobby() {
    playing = false;
    running = false;
    paused = false;
    cancelPendingRebuild();
    cancelAnimationFrame(raf);
    raf = 0;
    score = 0;
    updateHud();
    syncStartButton();
    statusEl.textContent = "hit START to begin";

    if (showBoundaries) {
      prepareBoundaryPreview();
    } else {
      map = null;
      mapReady = false;
      setPlayfieldVisible(false);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function prepareBoundaryPreview() {
    cancelPendingRebuild();
    resizePlayfield();
    setPlayfieldVisible(true);
    mapReady = false;
    statusEl.textContent = "mapping boundaries…";

    const start = () => {
      if (!isOpen || playing) return;
      rebuildMap();
      statusEl.textContent = "hit START to begin";
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    if (document.fonts?.ready) {
      document.fonts.ready.then(start).catch(start);
    } else {
      start();
    }
  }

  tab.addEventListener("click", () => setOpen(!isOpen));
  closeBtn.addEventListener("click", () => setOpen(false));
  startBtn.addEventListener("click", () => {
    if (!isOpen) return;
    resetGame();
  });
  boundariesBtn.addEventListener("click", () => {
    showBoundaries = !showBoundaries;
    syncBoundariesButton();
    chrome.storage?.local?.set({ anyPageSnakeBoundaries: showBoundaries });

    if (!isOpen) return;
    if (showBoundaries) {
      if (playing && map) {
        // redraw with boxes; game keeps running
      } else if (!playing) {
        prepareBoundaryPreview();
      }
    } else if (!playing) {
      map = null;
      mapReady = false;
      setPlayfieldVisible(false);
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      statusEl.textContent = "hit START to begin";
    }
  });
  dimBtn.addEventListener("click", () => {
    dimPage = !dimPage;
    syncDimButton();
    chrome.storage?.local?.set({ anyPageSnakeDim: dimPage });
  });

  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === "TOGGLE_SNAKE_CABINET") setOpen(!isOpen);
  });

  // ---- Game state ----
  let map = null;
  let mapGeneration = 0;
  let mapReady = false;
  let pendingRebuildGen = 0;
  let rebuildDebounceTimer = 0;
  let snake, dir, nextDir, food, score, tickMs, acc, lastTime, running, paused, raf;

  function resizePlayfield() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    playfield.width = Math.floor(window.innerWidth * dpr);
    playfield.height = Math.floor(window.innerHeight * dpr);
    playfield.style.width = `${window.innerWidth}px`;
    playfield.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function cancelPendingRebuild() {
    clearTimeout(rebuildDebounceTimer);
    rebuildDebounceTimer = 0;
    pendingRebuildGen++;
  }

  function stopGame() {
    playing = false;
    running = false;
    cancelPendingRebuild();
    cancelAnimationFrame(raf);
    raf = 0;
    map = null;
    mapReady = false;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    statusEl.textContent = "";
    syncStartButton();
  }

  function pickOpenCell(exclude = []) {
    if (!map || !map.openCells.length) return null;
    const blockedSet = new Set(exclude.map((p) => `${p.x},${p.y}`));
    for (let i = 0; i < 80; i++) {
      const p = map.openCells[(Math.random() * map.openCells.length) | 0];
      if (!blockedSet.has(`${p.x},${p.y}`)) return { x: p.x, y: p.y };
    }
    return map.openCells.find((p) => !blockedSet.has(`${p.x},${p.y}`)) || null;
  }

  function findStartSnake() {
    const cx = (map.cols / 2) | 0;
    const cy = (map.rows / 2) | 0;
    // Prefer a horizontal run of 3 open cells near center.
    let bestStart = null;
    let bestDist = Infinity;
    for (const cell of map.openCells) {
      const a = { x: cell.x - 1, y: cell.y };
      const b = { x: cell.x - 2, y: cell.y };
      if (isBlocked(map, a.x, a.y) || isBlocked(map, b.x, b.y)) continue;
      const d = (cell.x - cx) ** 2 + (cell.y - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestStart = [
          { x: cell.x, y: cell.y },
          { x: a.x, y: a.y },
          { x: b.x, y: b.y },
        ];
      }
    }
    if (bestStart) return bestStart;
    const p = pickOpenCell();
    return p ? [p, p, p] : [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  }

  function placeFood() {
    food = pickOpenCell(snake) || { x: 0, y: 0 };
  }

  function updateHud() {
    scoreEl.textContent = `SCORE ${String(score).padStart(3, "0")}`;
  }

  function updateMapStatus() {
    if (!playing) {
      statusEl.textContent = showBoundaries && !mapReady
        ? "mapping boundaries…"
        : "hit START to begin";
      return;
    }
    if (!mapReady) {
      statusEl.textContent = "remapping…";
      return;
    }
    if (!running) {
      statusEl.textContent = "game over — enter or START to retry";
      syncStartButton();
      return;
    }
    if (paused) {
      statusEl.textContent = "paused";
      return;
    }
    const openPct = map.openCells.length / Math.max(1, map.cols * map.rows);
    const elements = map.elementBoxes?.length || 0;
    const elementBit = elements ? ` · ${elements} elements` : "";
    statusEl.textContent =
      map.openCells.length < 20
        ? "sparse text — mostly open field"
        : `${map.boxes.length} words${elementBit} · ${Math.round((1 - openPct) * 100)}% blocked`;
  }

  function rebuildMap() {
    const next = buildTextOccupancy(HOST_ID);
    next.generation = ++mapGeneration;
    map = next;
    mapReady = true;
    updateMapStatus();
    return map;
  }

  function remapCell(x, y, prevMap) {
    if (!prevMap) {
      return {
        x: Math.max(0, Math.min(map.cols - 1, x)),
        y: Math.max(0, Math.min(map.rows - 1, y)),
      };
    }
    return {
      x: Math.max(0, Math.min(map.cols - 1, Math.floor((x * map.cols) / prevMap.cols))),
      y: Math.max(0, Math.min(map.rows - 1, Math.floor((y * map.rows) / prevMap.rows))),
    };
  }

  function snakeNeedsReset(segments) {
    return segments.some(
      (s) =>
        s.x < 0 ||
        s.x >= map.cols ||
        s.y < 0 ||
        s.y >= map.rows ||
        isBlocked(map, s.x, s.y)
    );
  }

  function normalizeGameStateAfterRebuild(prevMap) {
    if (!map || !snake) return;

    let body = snake.map((s) => remapCell(s.x, s.y, prevMap));
    if (snakeNeedsReset(body)) {
      snake = findStartSnake();
    } else {
      snake = body;
    }

    if (food) {
      food = remapCell(food.x, food.y, prevMap);
      if (
        isBlocked(map, food.x, food.y) ||
        snake.some((s) => s.x === food.x && s.y === food.y)
      ) {
        placeFood();
      }
    }
  }

  function commitMapRebuild(requestGen) {
    if (requestGen !== pendingRebuildGen || !isOpen) return;

    const prevMap = map;
    rebuildMap();
    if (playing) normalizeGameStateAfterRebuild(prevMap);
  }

  function scheduleRebuild() {
    if (!isOpen) return;
    if (!playing && !showBoundaries) return;

    mapReady = false;
    updateMapStatus();

    const requestGen = ++pendingRebuildGen;
    clearTimeout(rebuildDebounceTimer);
    rebuildDebounceTimer = setTimeout(() => {
      rebuildDebounceTimer = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          commitMapRebuild(requestGen);
        });
      });
    }, 50);
  }

  function resetGame() {
    cancelPendingRebuild();
    resizePlayfield();
    setPlayfieldVisible(true);
    playing = true;
    mapReady = false;
    updateMapStatus();
    syncStartButton();

    const start = () => {
      if (!isOpen || !playing) return;
      rebuildMap();
      snake = findStartSnake();
      dir = { x: 1, y: 0 };
      nextDir = dir;
      score = 0;
      tickMs = 110;
      acc = 0;
      lastTime = performance.now();
      running = true;
      paused = false;
      placeFood();
      updateHud();
      syncStartButton();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    if (document.fonts?.ready) {
      document.fonts.ready.then(start).catch(start);
    } else {
      start();
    }
  }

  function loop(t) {
    if (!isOpen) return;
    raf = requestAnimationFrame(loop);
    if (!playing || !running || paused) {
      draw();
      return;
    }
    const dt = t - lastTime;
    lastTime = t;
    acc += dt;
    if (acc >= tickMs) {
      acc = 0;
      step();
    }
    draw();
  }

  function step() {
    if (!mapReady || !map) return;

    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wrap at viewport edges so dense pages stay playable.
    if (head.x < 0) head.x = map.cols - 1;
    else if (head.x >= map.cols) head.x = 0;
    if (head.y < 0) head.y = map.rows - 1;
    else if (head.y >= map.rows) head.y = 0;

    if (isBlocked(map, head.x, head.y) || snake.some((s) => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      updateHud();
      tickMs = Math.max(55, tickMs - 1.5);
      placeFood();
    } else {
      snake.pop();
    }
  }

  function endGame() {
    running = false;
    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${String(best).padStart(3, "0")}`;
      chrome.storage?.local?.set({ anyPageSnakeBest: best });
    }
    updateMapStatus();
    syncStartButton();
  }

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    if (!map) return;

    if (playing && dimPage) {
      ctx.fillStyle = "rgba(12, 10, 8, 0.28)";
      ctx.fillRect(0, 0, w, h);
    }

    // Word / element ink — only when Boundaries is ON and map is settled.
    if (showBoundaries && mapReady && map.generation === mapGeneration) {
      ctx.fillStyle = "rgba(255, 140, 26, 0.22)";
      for (const b of map.boxes) {
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      if (map.elementBoxes?.length) {
        ctx.fillStyle = "rgba(80, 160, 220, 0.28)";
        for (const b of map.elementBoxes) {
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
      }
    }

    if (!playing) {
      if (!mapReady && showBoundaries) {
        ctx.fillStyle = "#d8c9a0";
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("mapping boundaries…", w / 2, h / 2);
      }
      return;
    }

    const cell = map.cell;

    // Food
    ctx.fillStyle = "#ff8c1a";
    ctx.shadowColor = "#ff8c1a";
    ctx.shadowBlur = 10;
    ctx.fillRect(food.x * cell + 2, food.y * cell + 2, cell - 4, cell - 4);
    ctx.shadowBlur = 0;

    // Snake
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#ffd08a" : "#ffb347";
      ctx.shadowColor = "#ffb347";
      ctx.shadowBlur = i === 0 ? 12 : 4;
      ctx.fillRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2);
    });
    ctx.shadowBlur = 0;

    if (paused && running) {
      ctx.fillStyle = "rgba(18,16,12,0.45)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffb347";
      ctx.font = "bold 28px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", w / 2, h / 2);
    }

    if (!mapReady) {
      ctx.fillStyle = "#d8c9a0";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("remapping…", w / 2, h / 2);
    }

    if (!running) {
      ctx.fillStyle = "#ffb347";
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GAME OVER", w / 2, h / 2 - 12);
      ctx.font = "14px monospace";
      ctx.fillStyle = "#d8c9a0";
      ctx.fillText("press enter or START to retry", w / 2, h / 2 + 14);
    }
  }

  window.addEventListener("resize", () => {
    if (!isOpen) return;
    if (!playing && !showBoundaries) return;
    resizePlayfield();
    scheduleRebuild();
  });
  window.addEventListener("scroll", () => {
    if (!isOpen) return;
    if (!playing && !showBoundaries) return;
    scheduleRebuild();
  }, { passive: true });

  const KEY_DIRS = {
    ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
  };

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!playing) return;
      if (KEY_DIRS[e.key]) {
        if (!running || !snake) return;
        const d = KEY_DIRS[e.key];
        if (snake.length > 1 && d.x === -dir.x && d.y === -dir.y) return;
        nextDir = d;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        if (running) {
          paused = !paused;
          updateMapStatus();
        }
        e.preventDefault();
      } else if (e.key === "Enter" && !running) {
        resetGame();
        e.preventDefault();
      }
    },
    true
  );
})();
