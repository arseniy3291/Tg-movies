const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const hdrezka = require('./providers/hdrezka');
const { handlePlayerProxy } = require('./providers/adblock');

const zlib = require('zlib');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';

// ── Встроенная сжатие Gzip для минимального размера передаваемых данных ──
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip') || req.url.startsWith('/api/image') || req.url.startsWith('/api/hdrezka/image') || req.url.startsWith('/api/player-proxy')) {
    return next();
  }

  const oldSend = res.send;
  res.send = function (body) {
    if (res.headersSent || !body) return oldSend.call(this, body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (buf.length < 1024) return oldSend.call(this, body);

    zlib.gzip(buf, (err, gzipped) => {
      if (err) return oldSend.call(this, body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', gzipped.length);
      oldSend.call(this, gzipped);
    });
  };
  next();
});

app.use(cors());
// Raw body parser specifically for /api/player-proxy so JSON primitive strings and form-urlencoded bodies are forwarded verbatim
app.use('/api/player-proxy', express.raw({ type: '*/*', limit: '2mb' }));
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true
}));

// ── Внутренний кэш API ответов Кинопоиска в RAM (10 минут TTL) ────
const apiCacheMap = new Map();
const API_CACHE_TTL = 10 * 60 * 1000;

async function kpFetch(urlPath, ttl = API_CACHE_TTL) {
  const now = Date.now();
  if (apiCacheMap.has(urlPath)) {
    const entry = apiCacheMap.get(urlPath);
    if (now - entry.timestamp < (entry.ttl || ttl)) {
      return entry.data;
    }
    apiCacheMap.delete(urlPath);
  }

  try {
    const response = await axios.get(`https://kinopoiskapiunofficial.tech${urlPath}`, {
      headers: { 'X-API-KEY': KP_KEY },
      timeout: 8000
    });
    if (apiCacheMap.size >= 500) {
      apiCacheMap.delete(apiCacheMap.keys().next().value);
    }
    apiCacheMap.set(urlPath, { data: response.data, timestamp: now, ttl });
    return response.data;
  } catch (error) {
    console.error(`[kpFetch] Error ${urlPath}:`, error.message);
    throw error;
  }
}

function formatRating(raw) {
  if (raw === null || raw === undefined || raw === 'null' || raw === '') return '';
  let val = raw;
  if (typeof val === 'string' && val.endsWith('%')) {
    const pct = parseFloat(val);
    if (!isNaN(pct) && pct > 0) return (pct / 10).toFixed(1);
    return '';
  }
  const num = parseFloat(val);
  if (!isNaN(num) && num > 0) return num.toFixed(1);
  return '';
}

// ── Маппинг данных с КП в формат нашего приложения ────────────────
function mapCard(item) {
  if (!item) return null;
  const rawPoster = item.posterUrlPreview || item.posterUrl || '';
  if (!rawPoster || rawPoster.includes('no-poster.png')) return null;

  const rawId = item.kinopoiskId || item.filmId;
  if (!rawId) return null;
  const id = String(rawId);
  const title = item.nameRu || item.nameOriginal || item.nameEn || 'Без названия';
  const originalTitle = item.nameOriginal || item.nameEn || '';
  const poster = `/api/image?url=${encodeURIComponent(rawPoster)}`;
  const year = item.year && String(item.year) !== 'null' ? String(item.year) : '';
  const genres = Array.isArray(item.genres) ? item.genres.map(g => g.genre).filter(Boolean) : [];
  const info = [year, genres.slice(0, 2).join(', ')].filter(Boolean).join(', ');

  const ratingKp = formatRating(item.ratingKinopoisk ?? item.rating);
  const ratingImdb = formatRating(item.ratingImdb);
  const ratingAwait = formatRating(item.ratingAwait);
  const ratingDisplay = ratingKp || ratingImdb || ratingAwait || '';

  return {
    id,
    provider: 'kinopoisk',
    title,
    originalTitle,
    poster,
    year,
    info,
    rating: ratingDisplay,
    ratingKp,
    ratingImdb,
    url: `/movie/${id}`
  };
}

// ════════════════════════════════════════════════════════════════
// API Приложения
// ════════════════════════════════════════════════════════════════

// ── Память кэша обложек для молниеносной загрузки ─────────────────
const imageCache = new Map();
const MAX_IMAGE_CACHE = 300;

app.get('/api/image', async (req, res) => {
  const urlStr = req.query.url;
  if (!urlStr) return res.status(400).end();
  
  // Возврат из RAM кэша сервера
  if (imageCache.has(urlStr)) {
    const cached = imageCache.get(urlStr);
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(cached.buffer);
  }

  try {
    const response = await axios.get(urlStr, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: { 
        'X-API-KEY': KP_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kinopoisk.ru/'
      }
    });
    
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);

    // Ограничение размера RAM кэша
    if (imageCache.size >= MAX_IMAGE_CACHE) {
      const firstKey = imageCache.keys().next().value;
      imageCache.delete(firstKey);
    }
    imageCache.set(urlStr, { buffer, contentType });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  } catch (e) {
    console.error(`[image] Proxy fail: ${urlStr}`, e.message);
    res.status(e.response?.status || 500).end();
  }
});

const GENRE_MAP = {
  '1': 'триллер',
  '2': 'драма',
  '3': 'криминал',
  '4': 'мелодрама',
  '6': 'фантастика',
  '11': 'боевик',
  '12': 'приключения',
  '13': 'комедия',
  '17': 'ужасы',
  '18': 'мультфильм'
};

app.get('/api/popular', async (req, res) => {
  try {
    const type = req.query.type || 'films';
    const sort = req.query.sort || 'popular';
    const page = Math.max(1, parseInt(req.query.page) || 1);

    let collectionType = 'TOP_POPULAR_MOVIES';
    if (type === 'series') {
      collectionType = sort === 'rating' ? 'TOP_250_TV_SHOWS' : 'POPULAR_SERIES';
    } else if (sort === 'rating') {
      collectionType = 'TOP_250_MOVIES';
    }

    const kpPath = `/api/v2.2/films/collections?type=${collectionType}&page=${page}`;
    const data = await kpFetch(kpPath);
    const items = data.items || [];

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(items.map(mapCard).filter(Boolean));
  } catch (e) {
    console.error('[popular error]', e.message);
    res.status(500).json({ error: 'Ошибка загрузки каталога Кинопоиска' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const qLower = q.toLowerCase();
    const genre = req.query.genre || '';
    const year = req.query.year || '';
    const ratingFrom = req.query.ratingFrom || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);

    if (!q && !genre && !year && !ratingFrom) return res.json([]);

    const CURATED = {
      'netflix': [4365427, 915196, 1044004, 655800, 1301710, 1045553, 1046206, 716587],
      'hbo': [464963, 1178445, 839458, 1227803, 681831, 986788, 79848, 402955],
      'apple tv': [1309707, 1048143, 1343318, 462765, 4541515, 673871, 4397580],
      'кинопоиск': [1355059, 1405843, 1355060, 4642708, 4642803],
      'amazon prime': [460586, 1171895, 1209839, 982730, 1112513],
      'амедиатека': [863009, 277537, 1321182, 1197956, 2000461, 737644]
    };

    let curatedCards = [];
    if (!genre && !year && !ratingFrom && qLower && CURATED[qLower] && page === 1) {
      const curRequests = CURATED[qLower].map(id => kpFetch(`/api/v2.2/films/${id}`, 60 * 60 * 1000).catch(() => null));
      const curatedData = await Promise.all(curRequests);
      curatedCards = curatedData.filter(Boolean).map(mapCard).filter(Boolean);
    }

    let kwCards = [];
    if (!genre && !year && !ratingFrom && q) {
      const kwData = await kpFetch(`/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(q)}&page=${page}`, 5 * 60 * 1000);
      kwCards = (kwData.films || []).map(mapCard).filter(Boolean);
    } else {
      let kpUrl = `/api/v2.2/films?order=NUM_VOTE&page=${page}`;
      if (q) kpUrl += `&keyword=${encodeURIComponent(q)}`;
      if (genre) kpUrl += `&genres=${encodeURIComponent(genre)}`;
      if (ratingFrom) kpUrl += `&ratingFrom=${encodeURIComponent(ratingFrom)}`;
      if (year) {
        if (year.includes('-')) {
          const [from, to] = year.split('-');
          kpUrl += `&yearFrom=${encodeURIComponent(from)}&yearTo=${encodeURIComponent(to)}`;
        } else {
          kpUrl += `&yearFrom=${encodeURIComponent(year)}&yearTo=${encodeURIComponent(year)}`;
        }
      }
      const data = await kpFetch(kpUrl, 5 * 60 * 1000);
      kwCards = (data.items || []).map(mapCard).filter(Boolean);
    }

    const seen = new Set();
    const combined = [...curatedCards, ...kwCards].filter(card => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });

    res.setHeader('Cache-Control', 'public, max-age=180');
    res.json(combined);
  } catch (e) {
    console.error('[search error]', e.message);
    res.status(500).json({ error: 'Ошибка поиска Кинопоиска' });
  }
});

app.get('/api/discover', async (req, res) => {
  try {
    const genre = req.query.genre || '';
    const type = req.query.type || 'films';
    const sort = req.query.sort === 'rating' ? 'RATING' : 'NUM_VOTE';
    const page = Math.max(1, parseInt(req.query.page) || 1);

    const kpTypes = type === 'series' ? 'TV_SERIES' : 'FILM';
    let kpUrl = `/api/v2.2/films?order=${sort}&ratingFrom=6&page=${page}`;
    if (genre) kpUrl += `&genres=${encodeURIComponent(genre)}`;
    if (kpTypes) kpUrl += `&type=${kpTypes}`;

    const data = await kpFetch(kpUrl);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json((data.items || []).map(mapCard).filter(Boolean));
  } catch (e) {
    console.error('[discover error]', e.message);
    res.status(500).json({ error: 'Ошибка загрузки жанров Кинопоиска' });
  }
});

app.get('/api/movie', async (req, res) => {
  try {
    const rawId = String(req.query.id || req.query.url || '').split('/').pop().trim();
    if (rawId.startsWith('hd_')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json(await hdrezka.movie(rawId));
    }
    if (!rawId || !/^\d+$/.test(rawId)) {
      return res.status(400).json({ error: 'Неверный ID фильма Кинопоиска' });
    }

    const [data, staffData] = await Promise.all([
      kpFetch(`/api/v2.2/films/${rawId}`, 60 * 60 * 1000),
      kpFetch(`/api/v1/staff?filmId=${rawId}`, 60 * 60 * 1000).catch(() => [])
    ]);

    let directors = [];
    let actors = [];
    if (Array.isArray(staffData)) {
      directors = staffData.filter(s => s.professionKey === 'DIRECTOR').slice(0, 3).map(s => s.nameRu || s.nameEn).filter(Boolean);
      actors = staffData.filter(s => s.professionKey === 'ACTOR').slice(0, 8).map(s => s.nameRu || s.nameEn).filter(Boolean);
    }

    const ratingKp = formatRating(data.ratingKinopoisk);
    const ratingImdb = formatRating(data.ratingImdb);
    const rating = ratingKp || ratingImdb || formatRating(data.ratingAwait) || '';

    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({
      id: String(data.kinopoiskId || rawId),
      provider: 'kinopoisk',
      title: data.nameRu || data.nameOriginal || data.nameEn || 'Без названия',
      originalTitle: data.nameOriginal || data.nameEn || '',
      description: data.description || data.shortDescription || 'Нет описания',
      poster: data.posterUrl ? `/api/image?url=${encodeURIComponent(data.posterUrl)}` : '',
      year: data.year ? String(data.year) : '',
      genre: data.genres?.map(g => g.genre).join(', ') || '',
      rating,
      ratingKp,
      ratingImdb,
      ratingKpCount: data.ratingKinopoiskVoteCount || 0,
      ratingImdbCount: data.ratingImdbVoteCount || 0,
      countries: data.countries?.map(c => c.country).join(', ') || '',
      length: data.filmLength ? `${data.filmLength} мин.` : '',
      directors: directors.join(', '),
      actors: actors.join(', '),
      url: `/movie/${data.kinopoiskId || rawId}`,
      videoSources: []
    });
  } catch (e) {
    console.error(`[movie] Error fetching ID ${req.query.id || req.query.url}:`, e.message);
    res.status(500).json({ error: 'Ошибка загрузки фильма', details: e.message });
  }
});

// ── API для получения источников видео (только Kinogo и HDRezka через Crawl4AI) ──
app.get('/api/video-sources', async (req, res) => {
  try {
    const { title = '', originalTitle = '', year = '' } = req.query;
    if (!title && !originalTitle) {
      return res.status(400).json({ error: 'Требуется название фильма' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const result = await hdrezka.resolveSources({ title, originalTitle, year });
    res.json(result);
  } catch (e) {
    console.error('[video-sources] Error:', e.message);
    res.status(502).json({ error: 'Ошибка загрузки источников Kinogo / HDRezka', details: e.message });
  }
});

app.all('/api/player-proxy', express.raw({ type: '*/*', limit: '2mb' }), handlePlayerProxy);

app.get('/api/hdrezka/image', async (req, res) => {
  const imgPath = req.query.path;
  if (typeof imgPath !== 'string' || !/^\/uploads\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp)$/i.test(imgPath)) {
    return res.sendStatus(400);
  }
  try {
    const response = await hdrezka.request(imgPath, true);
    const type = response.headers['content-type'] || '';
    if (!/^image\/(jpeg|png|webp)(;|$)/i.test(type)) return res.sendStatus(502);
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400').send(Buffer.from(response.data));
  } catch {
    res.sendStatus(502);
  }
});

// ── Поддержка SPA маршрутизации ───────────────────────────────
app.get('/*all', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌐 CineGram Server (Kinopoisk API) --> http://localhost:${PORT}`);
});
