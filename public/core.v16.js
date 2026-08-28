'use strict';

// ── Telegram WebApp ───────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ══════════════════════════════════════════════════════════════
// ASCII HERO BANNER — Matrix Rain with Mouse Glow & Observer Pause
// ══════════════════════════════════════════════════════════════
(function initAsciiBanner() {
  const banner = document.getElementById('hero');
  const canvas = document.getElementById('ascii-canvas');
  if (!banner || !canvas) return;

  const ctx = canvas.getContext('2d');
  const chars = '░▒▓█▀▄▌▐│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
  
  const resScale = 1.0;
  const fontSize = 20; 
  let columns = [];
  let mouse = { x: -1000, y: -1000 };
  const glowRadius = 240;
  
  let lastTime = 0;
  const fps = 30;
  const interval = 1000 / fps;
  let isCanvasVisible = true;
  let animFrameId = null;

  function resize() {
    const rect = banner.getBoundingClientRect();
    canvas.width = rect.width * resScale;
    canvas.height = rect.height * 1.4 * resScale;
    initColumns();
  }

  function initColumns() {
    columns = [];
    const colCount = Math.floor(canvas.width / (fontSize * 0.85)); 
    for (let i = 0; i < colCount; i++) {
      const dropCount = 3 + Math.floor(Math.random() * 4);
      for (let d = 0; d < dropCount; d++) {
        columns.push({
          x: i * (fontSize * 0.85),
          y: Math.random() * canvas.height,
          speed: (0.7 + Math.random() * 1.6) * resScale,
          char: chars[Math.floor(Math.random() * chars.length)],
          baseAlpha: 0.12 + Math.random() * 0.18,
        });
      }
    }
  }

  function draw(timestamp) {
    if (!isCanvasVisible) {
      animFrameId = null;
      return;
    }
    animFrameId = requestAnimationFrame(draw);
    
    const delta = timestamp - lastTime;
    if (delta < interval) return;
    lastTime = timestamp - (delta % interval);

    ctx.fillStyle = 'rgba(8, 8, 8, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontSize}px monospace`;

    const r2 = glowRadius * glowRadius;

    for (const drop of columns) {
      drop.y += drop.speed;

      if (drop.y > canvas.height + fontSize) {
        drop.y = -fontSize;
        drop.speed = (0.8 + Math.random() * 1.5) * resScale;
      }

      if (Math.random() < 0.02) {
        drop.char = chars[Math.floor(Math.random() * chars.length)];
      }

      const dx = mouse.x * resScale - drop.x;
      const dy = mouse.y * resScale - drop.y;
      const distSq = dx * dx + dy * dy;
      
      let alpha, r, g, b;
      
      if (distSq < r2) {
        const glowFactor = 1 - Math.sqrt(distSq) / glowRadius;
        alpha = Math.min(1, drop.baseAlpha + glowFactor * 0.85);
        r = 255;
        g = 40 + Math.floor(glowFactor * 120);
        b = 30 + Math.floor(glowFactor * 100);
      } else {
        alpha = drop.baseAlpha;
        r = 220; g = 20; b = 20; 
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillText(drop.char, drop.x, drop.y);
    }
  }

  // Pause loop when off-screen for 0% CPU/GPU overhead
  const bannerObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      isCanvasVisible = entry.isIntersecting;
      if (isCanvasVisible && !animFrameId) {
        lastTime = performance.now();
        animFrameId = requestAnimationFrame(draw);
      }
    });
  }, { threshold: 0.01 });

  bannerObs.observe(banner);

  banner.addEventListener('mousemove', (e) => {
    const rect = banner.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });
  banner.addEventListener('touchmove', (e) => {
    const rect = banner.getBoundingClientRect();
    mouse.x = e.touches[0].clientX - rect.left;
    mouse.y = e.touches[0].clientY - rect.top;
  });
  banner.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

  window.addEventListener('resize', resize);
  resize();
  ctx.fillStyle = 'rgb(8, 8, 8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  animFrameId = requestAnimationFrame(draw);
})();

// ── История ───────────────────────────────────────────────────
const HIST_KEY = 'cinegram_v3_history';
function loadHist()  { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '{}'); } catch { return {}; } }
function saveHist()  { try { localStorage.setItem(HIST_KEY, JSON.stringify(State.history)); } catch {} }

function upsertHist(entry) {
  if (!entry?.url) return;
  State.history[entry.url] = { ...State.history[entry.url], ...entry, ts: Date.now() };
  saveHist();
}

// ── Избранное ──────────────────────────────────────────────────
const WATCH_KEY = 'cinegram_v3_watchlist';
function loadWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch { return []; } }
function saveWatch() { try { localStorage.setItem(WATCH_KEY, JSON.stringify(State.watchlist)); } catch {} }

function toggleWatch(movie) {
  const idx = State.watchlist.findIndex(m => m.id === movie.id);
  if (idx > -1) {
    State.watchlist.splice(idx, 1);
  } else {
    State.watchlist.push(movie);
  }
  saveWatch();
  renderWatchlistScreen();
  if (State.screen === 'movie' && State.currentMovie?.id === movie.id) {
    updateWatchBtn(movie);
  }
}

function updateWatchBtn(movie) {
  const btn = byId('btn-watchlist');
  if (!btn) return;
  const inWatch = State.watchlist.some(m => m.id === movie.id);
  btn.classList.toggle('active', inWatch);
  btn.querySelector('span').textContent = inWatch ? 'В списке' : 'В список';
  btn.querySelector('svg').style.fill = inWatch ? 'currentColor' : 'none';
}

const State = {
  screen:       'home',
  activeTab:    'popular',
  filterMode:   '', 
  filterValue:  '',
  page:         1,
  currentMovie: null,
  history:      loadHist(),
  watchlist:    loadWatch(),
  renderedIds:  new Set(),
  filters:      { genre: '', year: '' },
  manualPlayer: 'alloha',
  playerTimer:  null
};

const GENRES = [
  { id: 1, n: 'Триллер', c: 'genre-thriller' },
  { id: 2, n: 'Драма', c: 'genre-drama' },
  { id: 3, n: 'Криминал', c: 'genre-crime' },
  { id: 4, n: 'Мелодрама', c: 'genre-romance' },
  { id: 6, n: 'Фантастика', c: 'genre-scifi' },
  { id: 11, n: 'Боевик', c: 'genre-action' },
  { id: 13, n: 'Комедия', c: 'genre-comedy' },
  { id: 17, n: 'Ужасы', c: 'genre-horror' },
  { id: 12, n: 'Приключения', c: 'genre-adventure' }
];

const SERVICES = [
  { q: 'netflix', c: 'srv-netflix', n: 'Netflix' },
  { q: 'hbo', c: 'srv-hbo', n: 'HBO MAX' },
  { q: 'apple tv', c: 'srv-apple', n: 'Apple TV+' },
  { q: 'кинопоиск', c: 'srv-kinopoisk', n: 'Кинопоиск' },
  { q: 'amazon prime', c: 'srv-amz', n: 'Prime' },
  { q: 'амедиатека', c: 'srv-amediateka', n: 'Амедиатека' }
];

// ── DOM ───────────────────────────────────────────────────────
const byId = id => document.getElementById(id);

const Screens = {
  home:      byId('screen-home'),
  movie:     byId('screen-movie'),
  history:   byId('screen-history'),
  watchlist: byId('screen-watchlist'),
  faq:       byId('screen-faq'),
  secret:    byId('screen-secret'),
};

// ════════════════════════════════════════════════════════════════
// НАВИГАЦИЯ И РОУТИНГ (History API)
// ════════════════════════════════════════════════════════════════

function showScreen(name, updateUrl = false) {
  Object.entries(Screens).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle('hidden', k !== name);
    el.classList.toggle('active', k === name);
  });
  
  byId('bottom-nav').style.display = (name === 'secret') ? 'none' : 'flex';
  State.screen = name;
  
  let docTitle = 'CineGram';
  if (name === 'history') docTitle = 'История | CineGram';
  else if (name === 'watchlist') docTitle = 'Мой список | CineGram';
  else if (name === 'faq') docTitle = 'FAQ | CineGram';
  else if (name === 'secret') docTitle = 'SECRET BESTIARIO';
  document.title = docTitle;
  
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });

  if (updateUrl) {
    let path = '/';
    if (name === 'history') path = '/history';
    else if (name === 'watchlist') path = '/watchlist';
    else if (name === 'faq') path = '/faq';
    else if (name === 'secret') path = '/secret';
    else if (name === 'home') {
       path = State.activeTab === 'films' ? '/' : `/${State.activeTab}`;
    }
    window.history.pushState({ screen: name, tab: State.activeTab }, '', path);
  }
}

function navigate(path, state = {}) {
  window.history.pushState(state, '', path);
  handleRoute();
}

async function handleRoute() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (!path.startsWith('/search')) closeSearch();

  if (path === '/' || path === '/popular' || path === '/films') {
    const q = params.get('q');
    if (q) {
      State.activeTab = 'popular';
      updateTabsUI();
      showScreen('home');
      byId('search-input').value = q;
      performSearch(q);
    } else {
      State.activeTab = (path === '/films') ? 'films' : 'popular';
      updateTabsUI();
      updateSectionTitle();
      showScreen('home');
      loadPopular(true);
    }
  } 
  else if (path === '/series') {
    State.activeTab = 'series';
    updateTabsUI();
    updateSectionTitle();
    showScreen('home');
    loadPopular(true);
  }
  else if (path === '/cartoons') {
    State.activeTab = 'cartoons';
    updateTabsUI();
    updateSectionTitle();
    showScreen('home');
    loadPopular(true);
  }
  else if (path.startsWith('/movie/')) {
    const id = path.split('/').pop();
    const saved = [...Object.values(State.history), ...State.watchlist].find(m => m.id === id);
    if (saved) {
      openMovieDetail(saved);
    } else {
      openMovieDetail({ url: `/movie/${id}`, id: id });
    }
  }
  else if (path === '/history') {
    renderHistoryScreen();
    showScreen('history');
  }
  else if (path === '/watchlist') {
    renderWatchlistScreen();
    showScreen('watchlist');
  }
  else if (path === '/faq') {
    showScreen('faq');
  }
  else if (path === '/secret') {
    openSecretScreen();
  }
  else {
    navigate('/');
  }
}

function updateTabsUI() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === State.activeTab);
  });
}

window.addEventListener('popstate', () => {
  handleRoute();
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.screen;
    let path = `/${t}`;
    if (t === 'home') path = '/';
    
    if (t === 'faq') {
      if (handleFaqClick()) return; 
    } else {
      faqClickCount = 0;
    }

    navigate(path);
  });
});

let faqClickCount = 0;
function handleFaqClick() {
  faqClickCount++;
  if (faqClickCount >= 10) {
    faqClickCount = 0;
    navigate('/secret');
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// КАРТОЧКИ С ОПТИМИЗАЦИЕЙ (Async decoding & lazy load)
// ════════════════════════════════════════════════════════════════

const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      obs.unobserve(e.target);
    }
  });
}, { rootMargin: '100px', threshold: 0.05 });

function makeCard(movie) {
  const hist     = State.history[movie.url] || null;
  const progress = hist?.duration ? (hist.currentTime / hist.duration) * 100 : 0;

  const div = document.createElement('div');
  div.className = 'movie-card fade-up';
  obs.observe(div);
  div.innerHTML = `
    ${movie.poster
      ? `<img src="${movie.poster}" alt="${movie.title || ''}" loading="lazy" decoding="async" onerror="this.parentElement.style.background='var(--bg3)';this.remove()">`
      : ''}
    <div class="card-shade">
      <div class="card-name">${movie.title || ''}</div>
      ${movie.info ? `<div class="card-year">${movie.info}</div>` : ''}
    </div>
    <div class="card-rtg"><span class="star-icon">★</span> ${movie.rating || '—'}</div>
    ${progress > 2 ? `<div class="card-pg"><div class="card-pg-fill" style="width:${Math.min(progress,100)}%"></div></div>` : ''}
  `;
  div.addEventListener('click', () => navigate(movie.url));

  const inWatch = State.watchlist.some(m => m.id === movie.id);
  const watchBtn = document.createElement('button');
  watchBtn.className = `card-watchlist-btn ${inWatch ? 'active' : ''}`;
  watchBtn.innerHTML = inWatch 
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
  
  watchBtn.onclick = (e) => {
    e.stopPropagation();
    toggleWatch(movie);
    const nowIn = State.watchlist.some(m => m.id === movie.id);
    watchBtn.classList.toggle('active', nowIn);
    watchBtn.innerHTML = nowIn
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
  };
  div.appendChild(watchBtn);

  return div;
}

function shimmers(container, n = 6) {
  const frag = document.createDocumentFragment();
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'shimmer';
    frag.appendChild(d);
  }
  container.appendChild(frag);
}

// ════════════════════════════════════════════════════════════════
// ГЛАВНАЯ — КАТАЛОГ (DocumentFragment Batching & Fast SWR)
// ════════════════════════════════════════════════════════════════

const popularGrid = byId('popular-grid');
const homeScroll  = document.querySelector('.home-scroll');
let   isLoading   = false;

async function loadPopular(reset = false) {
  if (reset) {
    State.page = 1;
    State.renderedIds.clear();
    shimmers(popularGrid, 9);
  }
  if (isLoading) return;
  isLoading = true;

  try {
    const genreParam = State.filters.genre ? `&genre=${encodeURIComponent(State.filters.genre)}` : '';
    const endpoint = `/api/popular?type=${State.activeTab}${genreParam}&page=${State.page}`;

    const data = await api(endpoint);
    if (reset) popularGrid.innerHTML = '';

    const unique = data.filter(m => {
      if (State.renderedIds.has(m.id)) return false;
      State.renderedIds.add(m.id);
      return true;
    });

    const frag = document.createDocumentFragment();
    unique.forEach(m => frag.appendChild(makeCard(m)));
    popularGrid.appendChild(frag);

    State.page++;
    isLoading = false;
  } catch {
    if (reset) popularGrid.innerHTML = `<div class="empty-hint" style="grid-column:1/-1"><div class="empty-icon">😕</div><p>Не удалось загрузить.</p></div>`;
    isLoading = false;
  }
}

homeScroll.addEventListener('scroll', () => {
  if (isLoading || State.screen !== 'home') return;
  if (homeScroll.scrollTop + homeScroll.clientHeight >= homeScroll.scrollHeight - 600) {
    loadPopular(false);
  }
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    State.activeTab = type;
    updateTabsUI();
    updateSectionTitle();
    const path = type === 'popular' ? '/' : `/${type}`;
    window.history.pushState({ screen: 'home', tab: type }, '', path);
    loadPopular(true);
  });
});

function toggleGenreFilter(genreId) {
  const strId = String(genreId);
  if (State.filters.genre === strId) {
    State.filters.genre = '';
  } else {
    State.filters.genre = strId;
  }
  updateGenreCardsUI();
  updateSectionTitle();
  loadPopular(true);
}

function updateGenreCardsUI() {
  const gRow = byId('genres-row');
  if (!gRow) return;
  gRow.querySelectorAll('.service-card').forEach(card => {
    const isMatch = card.dataset.genreId === State.filters.genre;
    card.classList.toggle('active', isMatch);
  });
}

function updateSectionTitle() {
  const titleEl = popularGrid.previousElementSibling?.querySelector('.section-title');
  if (!titleEl) return;
  
  const tabNames = {
    popular: 'Популярное',
    films: 'Фильмы',
    series: 'Сериалы',
    cartoons: 'Мультфильмы'
  };
  
  const currentTabName = tabNames[State.activeTab] || 'Популярное';
  const activeGenreObj = GENRES.find(g => String(g.id) === State.filters.genre);
  
  if (activeGenreObj) {
    titleEl.textContent = `${currentTabName}: ${activeGenreObj.n}`;
  } else {
    titleEl.textContent = currentTabName;
  }
}

function renderGenresAndServices() {
  const gRow = byId('genres-row');
  if (!gRow) return;

  const frag = document.createDocumentFragment();

  GENRES.forEach(g => {
    const div = document.createElement('div');
    const isActive = String(g.id) === State.filters.genre;
    div.className = `service-card ${g.c} fade-up ${isActive ? 'active' : ''}`;
    div.dataset.genreId = String(g.id);
    div.textContent = g.n;
    div.onclick = () => toggleGenreFilter(g.id);
    obs.observe(div);
    frag.appendChild(div);
  });

  gRow.innerHTML = '';
  gRow.appendChild(frag);
}

// ════════════════════════════════════════════════════════════════
// ИСТОРИЯ
// ════════════════════════════════════════════════════════════════

function renderHistoryStrip() {
  const sec  = byId('section-history');
  const row  = byId('history-row');
  if (!sec || !row) return;
  const entries = Object.values(State.history)
    .filter(e => e.currentTime > 5)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 12);
  if (!entries.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  
  const frag = document.createDocumentFragment();
  entries.forEach(e => frag.appendChild(makeCard(e)));
  row.innerHTML = '';
  row.appendChild(frag);
}

function renderHistoryScreen() {
  const container = byId('history-full');
  const empty     = byId('history-empty');
  const entries   = Object.values(State.history).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  container.innerHTML = '';
  if (!entries.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  entries.forEach(e => {
    const pct = e.duration ? (e.currentTime / e.duration) * 100 : 0;
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML = `
      ${e.poster
        ? `<img src="${e.poster}" decoding="async" alt="">`
        : '<div style="width:56px;aspect-ratio:2/3;background:var(--bg3);border-radius:8px;flex-shrink:0"></div>'}
      <div class="hist-info">
        <div class="hist-name">${e.title || '—'}</div>
        <div class="hist-meta">${e.info || ''}</div>
        ${pct > 0 ? `<div class="hist-pg"><div class="hist-pg-fill" style="width:${Math.min(pct,100)}%"></div></div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => openMovieDetail(e));
    frag.appendChild(div);
  });
  container.appendChild(frag);
}

byId('btn-clear').addEventListener('click', () => {
  if (!confirm('Очистить всю историю просмотров?')) return;
  State.history = {};
  saveHist();
  renderHistoryScreen();
  renderHistoryStrip();
});

function renderWatchlistScreen() {
  const container = byId('watchlist-full');
  const empty     = byId('watchlist-empty');
  container.innerHTML = '';
  if (!State.watchlist.length) { 
    empty.classList.remove('hidden'); 
    return; 
  }
  empty.classList.add('hidden');
  const frag = document.createDocumentFragment();
  State.watchlist.forEach(m => frag.appendChild(makeCard(m)));
  container.appendChild(frag);
}

// ════════════════════════════════════════════════════════════════
// ПОИСК — Оптимизированная задержка (200ms debounce)
// ════════════════════════════════════════════════════════════════

const searchOverlay = byId('search-overlay');
const searchInput   = byId('search-input');
const searchGrid    = byId('search-results');
const searchEmpty   = byId('search-empty');
const searchLoader  = byId('search-loader');
let   searchTimer   = null;

byId('btn-search-open').addEventListener('click', () => {
  searchOverlay.classList.remove('hidden');
  searchOverlay.classList.remove('closing');
  searchOverlay.classList.add('active');
  setTimeout(() => searchInput.focus(), 150);
});

byId('btn-search-close-top').addEventListener('click', closeSearch);

function closeSearch() {
  searchOverlay.classList.remove('active');
  searchOverlay.classList.add('closing');
  
  setTimeout(() => {
    if (searchOverlay.classList.contains('closing')) {
      searchOverlay.classList.add('hidden');
      searchOverlay.classList.remove('closing');
      searchInput.value = '';
      searchGrid.innerHTML = '';
      searchEmpty.classList.add('hidden');
      searchLoader.classList.add('hidden');
      byId('btn-search-all').classList.add('hidden');
      byId('search-filters').classList.add('hidden');
      resetFilters();
    }
  }, 650);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  const viewport = byId('search-results-viewport');
  
  if (!q && !State.filters.genre && !State.filters.year) { 
    searchGrid.innerHTML = ''; 
    searchEmpty.classList.add('hidden');
    viewport.classList.add('hidden');
    return; 
  }
  
  viewport.classList.remove('hidden');
  searchLoader.classList.remove('hidden');
  searchGrid.innerHTML = '';
  searchEmpty.classList.add('hidden');

  const newUrl = q ? `/?q=${encodeURIComponent(q)}` : '/';
  window.history.replaceState({ screen: 'home' }, '', newUrl);

  // Fast 200ms debounce
  searchTimer = setTimeout(() => doSearch(q), 200);
});

byId('btn-search-settings').addEventListener('click', () => {
  byId('search-filters').classList.toggle('hidden');
});

byId('btn-search-trigger').addEventListener('click', () => {
  doSearch(searchInput.value.trim());
});

function initFilters() {
  document.querySelectorAll('#filter-genres .f-chip').forEach(btn => {
    btn.onclick = () => {
      const g = btn.dataset.genre;
      State.filters.genre = (State.filters.genre === g) ? '' : g;
      updateFilterUI();
      doSearch(searchInput.value.trim());
    };
  });

  const minInput = byId('year-min');
  const maxInput = byId('year-max');
  if (minInput && maxInput) {
    const sync = () => {
      let v1 = parseInt(minInput.value);
      let v2 = parseInt(maxInput.value);
      
      if (v1 > v2) {
        const temp = v1;
        v1 = v2;
        v2 = temp;
      }
      
      State.filters.year = `${v1}-${v2}`;
      updateYearSliderUI(v1, v2);
    };

    minInput.oninput = sync;
    maxInput.oninput = sync;
    
    minInput.onchange = () => doSearch(searchInput.value.trim());
    maxInput.onchange = () => doSearch(searchInput.value.trim());
  }

  byId('btn-filter-reset').onclick = () => {
    resetFilters();
    doSearch(searchInput.value.trim());
  };
}

function updateYearSliderUI(v1, v2) {
  const min = 1940;
  const max = 2024;
  const rangeDisplay = byId('year-range-display');
  const mask = byId('range-mask');
  
  if (rangeDisplay) rangeDisplay.textContent = `${v1} — ${v2}`;
  
  if (mask) {
    const left = ((v1 - min) / (max - min)) * 100;
    const right = ((v2 - min) / (max - min)) * 100;
    mask.style.left = left + '%';
    mask.style.width = (right - left) + '%';
  }
}

function updateFilterUI() {
  document.querySelectorAll('#filter-genres .f-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.genre === State.filters.genre);
  });
}

function resetFilters() {
  State.filters.genre = '';
  State.filters.year = '1960-2024';
  
  const minInput = byId('year-min');
  const maxInput = byId('year-max');
  if (minInput) minInput.value = 1960;
  if (maxInput) maxInput.value = 2024;
  
  updateYearSliderUI(1960, 2024);
  updateFilterUI();
}

async function doSearch(q) {
  const viewport = byId('search-results-viewport');
  const genre = State.filters.genre;
  const year  = State.filters.year;

  if (!q && !genre && !year) {
     searchGrid.innerHTML = '';
     searchLoader.classList.add('hidden');
     searchEmpty.classList.add('hidden');
     viewport.classList.add('hidden');
     return;
  }

  viewport.classList.remove('hidden');
  searchLoader.classList.remove('hidden');
  searchEmpty.classList.add('hidden');
  searchGrid.innerHTML = '';
  byId('btn-search-all').classList.add('hidden');

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&genre=${genre}&year=${year}`);
    searchLoader.classList.add('hidden');
    
    if (!data || !data.length) { 
      searchEmpty.classList.remove('hidden'); 
      return; 
    }

    const first = data[0];
    const others = data.slice(1, 6);

    renderSearchGroup('Возможно, вы искали', [first]);
    if (others.length > 0) {
      renderSearchGroup('Фильмы и сериалы', others);
    }

    byId('btn-search-all').classList.remove('hidden');

  } catch (err) {
    console.error('Search error:', err);
    searchLoader.classList.add('hidden');
    searchEmpty.classList.remove('hidden');
  }
}

function renderSearchGroup(title, items) {
  const header = document.createElement('div');
  header.className = 's-group-title';
  header.textContent = title;
  searchGrid.appendChild(header);

  const frag = document.createDocumentFragment();
  items.forEach(m => {
    const item = makeSearchItem(m);
    item.addEventListener('click', () => { closeSearch(); openMovieDetail(m); });
    frag.appendChild(item);
  });
  searchGrid.appendChild(frag);
}

function makeSearchItem(m) {
  const div = document.createElement('div');
  div.className = 's-item';

  const rtg = parseFloat(m.rating) || 0;
  const rtgClass = rtg >= 7 ? 'high' : rtg >= 4 ? 'mid' : 'low';
  
  const metaParts = m.info.split(', ');
  const year = metaParts[0] || '';
  const secondary = metaParts.slice(1).join(', ') || '';

  div.innerHTML = `
    <img src="${m.poster}" class="s-item-img" decoding="async" alt="" onerror="this.src='https://via.placeholder.com/44x64?text=?'">
    <div class="s-item-info">
      <div class="s-item-title">${m.title}</div>
      <div class="s-item-meta">
        ${rtg > 0 ? `<span class="s-item-rtg ${rtgClass}">${m.rating}</span>` : ''}
        <span>${secondary}${secondary && year ? ', ' : ''}${year}</span>
      </div>
    </div>
  `;
  return div;
}

// ════════════════════════════════════════════════════════════════
// ЭКРАН ДЕТАЛИ ФИЛЬМА
// ════════════════════════════════════════════════════════════════

async function openMovieDetail(movie, autoPlay = false, updateUrl = false) {
  State.currentMovie = movie;
  
  if (movie.title) document.title = `${movie.title} | CineGram`;

  if (updateUrl) {
    window.history.pushState({ id: movie.id }, '', movie.url);
  }

  byId('movie-title').textContent = movie.title || '';
  byId('movie-sub').textContent   = '';
  byId('movie-genre').textContent = '';
  byId('movie-desc').textContent  = '';
  byId('movie-rating').innerHTML  = '';
  byId('movie-poster').src        = movie.poster || '';
  byId('movie-bg').style.backgroundImage = movie.poster ? `url('${movie.poster}')` : '';
  
  byId('movie-year').textContent      = '—';
  byId('movie-countries').textContent = 'Загрузка...';
  byId('movie-length').textContent    = 'Загрузка...';
  byId('movie-directors').textContent = 'Загрузка...';
  byId('movie-actors').textContent    = 'Загрузка...';
  
  byId('movie-loader').classList.remove('hidden');

  const kbContainer = byId('kinobox-container');
  kbContainer.classList.add('hidden');
  kbContainer.querySelector('.kinobox_player').innerHTML = '';

  showScreen('movie');

  try {
    const detail = await api(`/api/movie?url=${encodeURIComponent(movie.url)}`);
    if (!detail.id) detail.id = movie.id;
    State.currentMovie = { ...movie, ...detail };

    byId('movie-title').textContent = detail.title || movie.title;
    byId('movie-poster').src        = detail.poster || movie.poster || '';
    byId('movie-bg').style.backgroundImage = (detail.poster || movie.poster) ? `url('${detail.poster || movie.poster}')` : '';
    
    byId('movie-sub').textContent   = [detail.year, detail.genre].filter(Boolean).join(' · ');
    byId('movie-year').textContent  = detail.year || '—';
    byId('movie-desc').textContent  = detail.description || '';

    if (detail.rating) {
      byId('movie-rating').innerHTML = `<span class="imdb-badge">${detail.rating}</span>`;
    }

    byId('movie-countries').textContent = detail.countries || '—';
    byId('movie-length').textContent    = detail.length || '—';
    byId('movie-directors').textContent = detail.directors || '—';
    byId('movie-actors').textContent    = detail.actors || '—';

    updateWatchBtn(State.currentMovie);

    if (autoPlay) launchKinobox();

  } catch (err) {
    console.error('[movie detail]', err);
    byId('movie-desc').textContent = 'Не удалось загрузить информацию.';
  } finally {
    byId('movie-loader').classList.add('hidden');
  }
}

byId('btn-back').addEventListener('click', () => {
  if (searchOverlay.classList.contains('active')) {
    closeSearch();
    return;
  }
  navigate('/');
});

byId('btn-watchlist').addEventListener('click', () => {
  if (State.currentMovie) toggleWatch(State.currentMovie);
});

(function injectPlayBtn() {
  if (byId('btn-play')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-play';
  btn.className = 'big-play-btn';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Смотреть`;
  btn.addEventListener('click', launchKinobox);

  const loader = byId('movie-loader');
  loader.parentNode.insertBefore(btn, loader);
})();

byId('btn-play')?.addEventListener('click', launchKinobox);

// ════════════════════════════════════════════════════════════════
// MULTI-SOURCE PLAYER (CLEAN MODE)
// ════════════════════════════════════════════════════════════════

const MIRRORS = [
  { id: 'alloha', name: 'Источник 1 (Чистый)', url: (id) => `https://alloha.tv/player/index.php?kp=${id}`, type: 'pure' },
  { id: 'bazon',  name: 'Источник 2 (Bazon)',   url: (id) => `https://bazon.cc/video/embed/kp/${id}`,      type: 'pure' },
  { id: 'khub',   name: 'Источник 3 (Mirror)',  url: (id) => `https://on.kinohub.vip/embed/kp/${id}`,      type: 'clipped' }
];

let playerState = {
  currentMirrorIndex: 0
};

function launchKinobox() {
  const movie = State.currentMovie;
  if (!movie) return;

  const kbContainer = byId('kinobox-container');
  const sourcesBar  = byId('player-sources');

  kbContainer.classList.remove('hidden');
  
  if (sourcesBar) {
    sourcesBar.innerHTML = MIRRORS.map((m, idx) => `
      <button class="source-btn ${idx === playerState.currentMirrorIndex ? 'active' : ''}" 
              onclick="switchPlayerSource(${idx})">
        ${m.name}
      </button>
    `).join('');
  }

  loadMirror(playerState.currentMirrorIndex);

  setTimeout(() => {
    kbContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);

  if (State.playerProgressInterval) clearInterval(State.playerProgressInterval);
  State.playerProgressInterval = setInterval(() => {
      upsertHist({
          url: movie.url, title: movie.title, poster: movie.poster,
          info: movie.info || '', currentTime: 10, duration: 100
      });
  }, 10000);

  upsertHist({
    url: movie.url, title: movie.title, poster: movie.poster,
    info: movie.info || '', currentTime: 0, duration: 0
  });
  renderHistoryStrip();
}

window.switchPlayerSource = function(index) {
  playerState.currentMirrorIndex = index;
  
  const btns = document.querySelectorAll('.source-btn');
  btns.forEach((btn, idx) => btn.classList.toggle('active', idx === index));
  
  loadMirror(index);
};

function loadMirror(index) {
  const movie = State.currentMovie;
  const playerDiv = byId('kinobox-container').querySelector('.kinobox_player');
  const wrapper = byId('kinobox-player-wrapper');
  const mirror = MIRRORS[index];

  if (!movie || !playerDiv) return;

  if (wrapper) {
    wrapper.classList.toggle('clipped', mirror.type === 'clipped');
  }

  playerDiv.innerHTML = `
    <iframe
      src="${mirror.url(movie.id)}"
      width="100%" height="100%"
      frameborder="0"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen
      referrerpolicy="no-referrer"
      style="border-radius:12px; background: #000;">
    </iframe>
  `;
}

// ════════════════════════════════════════════════════════════════
// API HELPERS (Client-side SWR Cache)
// ════════════════════════════════════════════════════════════════

const clientCache = new Map();

async function api(endpoint, useCache = true) {
  if (useCache && clientCache.has(endpoint)) {
    const cachedItem = clientCache.get(endpoint);
    // Background revalidation if older than 30s
    if (Date.now() - cachedItem.ts > 30000) {
      fetch(endpoint).then(r => r.ok ? r.json() : null).then(fresh => {
        if (fresh) clientCache.set(endpoint, { data: fresh, ts: Date.now() });
      }).catch(() => {});
    }
    return cachedItem.data;
  }

  const r = await fetch(endpoint);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  clientCache.set(endpoint, { data, ts: Date.now() });
  return data;
}

// ════════════════════════════════════════════════════════════════
// СЕКРЕТНЫЙ БЕСТИАРИЙ
// ════════════════════════════════════════════════════════════════

const SEC_ANIMALS = [
  {
    n: 'Tralelora',
    d: 'Уникальный гибрид пасты и кота. Появляется на кухне, когда вода перекипела. Плачет соусом маринара и требует "Al Dente!".',
    i: '/assets/tralelora_animal_1776066116109.png'
  },
  {
    n: 'Tralala',
    d: 'Божественный летающий кусок пиццы. Поет «O Sole Mio» в 3 часа ночи, чтобы сбить с толку туристов в Риме.',
    i: '/assets/tralala_animal_v2_1776066147208.png'
  },
  {
    n: 'Tung Tung',
    d: 'Массивная катящаяся тефтеля из говядины высшего сорта и моцареллы. Мигрирует через Тоскану каждую осень.',
    i: '/assets/tung_tung_animal_1776066170914.png'
  },
  {
    n: 'Sahur',
    d: 'Призрак эспрессо. Обитает в кофейнях. Если вы добавите слишком много сахара, он может украсть вашу ложечку навсегда.',
    i: '/assets/sahur_animal_v2_1776066207128.png'
  }
];

function initSecretScreen() {
  const closeBtn = byId('btn-secret-close');
  if (closeBtn) {
    closeBtn.onclick = () => showScreen('home', true);
  }
}

function openSecretScreen() {
  renderSecretScreen();
  showScreen('secret');
  byId('bottom-nav').style.display = 'none';
}

function renderSecretScreen() {
  const grid = byId('secret-grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  SEC_ANIMALS.forEach(a => {
    const div = document.createElement('div');
    div.className = 'secret-item fade-up';
    div.innerHTML = `
      <img src="${a.i}" alt="${a.n}" decoding="async" loading="lazy">
      <div class="secret-info">
        <div class="secret-name">🇮🇹 ${a.n}</div>
        <div class="secret-desc">${a.d}</div>
      </div>
    `;
    frag.appendChild(div);
    obs.observe(div);
  });
  grid.appendChild(frag);
}

function showToast(text) {
  const toast = byId('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

(function init() {
  renderHistoryStrip();
  renderGenresAndServices();
  initSecretScreen();
  initFilters();

  const logo = document.querySelector('.header-logo');
  if (logo) {
    logo.style.cursor = 'pointer';
    logo.onclick = () => navigate('/');
  }

  handleRoute(); 
})();
