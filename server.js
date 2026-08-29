const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const balancers = require('./balancers');

const zlib = require('zlib');

const app = express();
const PORT = 3000;
const KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';

// ── Встроенная сжатие Gzip для минимального размера передаваемых данных ──
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip') || req.url.startsWith('/api/image')) {
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true
}));

// ── Внутренний кэш API ответов Кинопоиска в RAM (10 минут TTL) ────
const apiCacheMap = new Map();
const API_CACHE_TTL = 10 * 60 * 1000;

async function kpFetch(urlPath) {
  const now = Date.now();
  if (apiCacheMap.has(urlPath)) {
    const entry = apiCacheMap.get(urlPath);
    if (now - entry.timestamp < API_CACHE_TTL) {
      return entry.data;
    }
    apiCacheMap.delete(urlPath);
  }

  try {
    const response = await axios.get(`https://kinopoiskapiunofficial.tech${urlPath}`, {
      headers: { 'X-API-KEY': KP_KEY },
      timeout: 8000
    });
    apiCacheMap.set(urlPath, { data: response.data, timestamp: now });
    return response.data;
  } catch (error) {
    console.error(`[kpFetch] Error ${urlPath}:`, error.message);
    throw error;
  }
}

// ── Маппинг данных с КП в формат нашего приложения ────────────────
function mapCard(item) {
  const rawPoster = item.posterUrlPreview || item.posterUrl || '';
  if (!rawPoster || rawPoster.includes('no-poster.png')) return null;

  const id = String(item.kinopoiskId || item.filmId);
  const title = item.nameRu || item.nameOriginal || item.nameEn || 'Без названия';
  const poster = `/api/image?url=${encodeURIComponent(rawPoster)}`;
  const info = [item.year, item.genres?.map(g => g.genre).slice(0, 2).join(', ')].filter(Boolean).join(', ');

  let rawRating = item.ratingKinopoisk || item.rating || item.ratingImdb || item.ratingAwait || '';
  if (typeof rawRating === 'string' && rawRating.endsWith('%')) {
    rawRating = (parseFloat(rawRating) / 10).toFixed(1);
  }

  let ratingDisplay = '';
  if (rawRating) {
    const rNum = parseFloat(rawRating);
    if (!isNaN(rNum) && rNum > 0) {
      ratingDisplay = rNum.toFixed(1);
    } else if (typeof rawRating === 'string' && rawRating.length > 0 && rawRating !== 'null') {
      ratingDisplay = rawRating;
    }
  }

  return { id, title, poster, info, rating: ratingDisplay, url: `/movie/${id}` };
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
    const page = parseInt(req.query.page) || 1;
    let kpPath = `/api/v2.2/films/collections?type=TOP_POPULAR_MOVIES&page=${page}`;
    
    if (type === 'series') {
      kpPath = `/api/v2.2/films/collections?type=TOP_250_TV_SHOWS&page=${page}`;
    }

    const data = await kpFetch(kpPath);
    const items = data.items || [];
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(items.map(mapCard).filter(Boolean));
  } catch (e) {
    console.error('[popular error]', e.message);
    res.status(500).json({ error: 'Ошибка загрузки каталога' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const genre = req.query.genre || '';
    const year = req.query.year || '';
    const page = parseInt(req.query.page) || 1;

    if (!q && !genre && !year) return res.json([]);

    const CURATED = {
      'netflix': [4365427, 915196, 1044004, 655800, 1301710, 1045553, 1046206, 716587],
      'hbo': [464963, 1178445, 839458, 1227803, 681831, 986788, 79848, 402955],
      'apple tv': [1309707, 1048143, 1343318, 462765, 4541515, 673871, 4397580],
      'кинопоиск': [1355059, 1405843, 1355060, 4642708, 4642803],
      'amazon prime': [460586, 1171895, 1209839, 982730, 1112513],
      'амедиатека': [863009, 277537, 1321182, 1197956, 2000461, 737644]
    };

    let curatedCards = [];
    if (!genre && !year && q && CURATED[q] && page === 1) {
      const curRequests = CURATED[q].map(id => kpFetch(`/api/v2.2/films/${id}`, 60 * 60 * 1000).catch(() => null));
      const curatedData = await Promise.all(curRequests);
      curatedCards = curatedData.filter(Boolean).map(mapCard).filter(Boolean);
    }

    let kwCards = [];
    if (!genre && !year && q) {
      const kwData = await kpFetch(`/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(q)}&page=${page}`, 5 * 60 * 1000);
      kwCards = (kwData.films || []).map(mapCard).filter(Boolean);
    } else {
      let kpUrl = `/api/v2.2/films?page=${page}`;
      if (q) kpUrl += `&keyword=${encodeURIComponent(q)}`;
      if (genre) kpUrl += `&genres=${genre}`;
      if (year) {
        if (year.includes('-')) {
          const [from, to] = year.split('-');
          kpUrl += `&yearFrom=${from}&yearTo=${to}`;
        } else {
          kpUrl += `&yearFrom=${year}&yearTo=${year}`;
        }
      }
      const data = await kpFetch(kpUrl, 5 * 60 * 1000);
      kwCards = (data.items || []).map(mapCard).filter(Boolean);
    }

    res.setHeader('Cache-Control', 'public, max-age=180');
    res.json([...curatedCards, ...kwCards]);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

app.get('/api/discover', async (req, res) => {
  try {
    const genre = req.query.genre || '';
    const type = req.query.type || 'films';
    const page = req.query.page || 1;
    
    let kpTypes = type === 'series' ? 'TV_SERIES' : 'FILM';

    let kpUrl = `/api/v2.2/films?order=RATING&ratingFrom=6&page=${page}`;
    if (genre) kpUrl += `&genres=${encodeURIComponent(genre)}`;
    if (kpTypes) kpUrl += `&type=${kpTypes}`;

    const data = await kpFetch(kpUrl);
    res.json((data.items || []).map(mapCard).filter(Boolean));
  } catch (e) {
    res.status(500).json({ error: 'Ошибка поиска жанров' });
  }
});

app.get('/api/movie', async (req, res) => {
  try {
    const urlStr = req.query.url || '';
    const id = urlStr.split('/').pop();
    if (!id) return res.status(400).json({ error: 'Неверный URL' });

    const [data, staffData] = await Promise.all([
      kpFetch(`/api/v2.2/films/${id}`, 60 * 60 * 1000),
      kpFetch(`/api/v1/staff?filmId=${id}`, 60 * 60 * 1000).catch(() => [])
    ]);

    let directors = [];
    let actors = [];
    if (Array.isArray(staffData)) {
      directors = staffData.filter(s => s.professionKey === 'DIRECTOR').slice(0, 2).map(s => s.nameRu || s.nameEn);
      actors = staffData.filter(s => s.professionKey === 'ACTOR').slice(0, 6).map(s => s.nameRu || s.nameEn);
    }

    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({
      id: String(data.kinopoiskId),
      title: data.nameRu || data.nameOriginal || 'Без названия',
      description: data.description || data.shortDescription || 'Нет описания',
      poster: data.posterUrl ? `/api/image?url=${encodeURIComponent(data.posterUrl)}` : '',
      year: data.year || '',
      genre: data.genres?.map(g => g.genre).join(', ') || '',
      rating: data.ratingKinopoisk || data.ratingImdb || '',
      countries: data.countries?.map(c => c.country).join(', ') || '',
      length: data.filmLength ? `${data.filmLength} мин.` : '',
      directors: directors.join(', '),
      actors: actors.join(', '),
      url: urlStr,
      videoSources: []
    });
  } catch (e) {
    console.error(`[movie] Error fetching ID ${req.query.url}:`, e.message);
    res.status(500).json({ error: 'Ошибка загрузки фильма', details: e.message });
  }
});

// ── API для получения источников видео ──────────────────────────
app.get('/api/video-sources', async (req, res) => {
  try {
    const { title, year, kpId } = req.query;
    
    if (!title && !kpId) {
      return res.status(400).json({error: 'Требуется название или Kinopoisk ID'});
    }
    
    let sources = [];
    
    if (title) {
      sources = await balancers.searchByTitle(title, year || null);
    }
    
    if (kpId && sources.length === 0) {
      const kpSources = await balancers.searchByKinopoiskId(kpId);
      sources.push(...kpSources);
    }
    
    res.json({ sources });
  } catch (e) {
    console.error('[video-sources] Error:', e.message);
    res.status(500).json({error: 'Ошибка поиска источников', details: e.message});
  }
});

// ── Поддержка SPA маршрутизации ───────────────────────────────
app.get('/*all', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌐 CineGram Server (Kinopoisk API) --> http://localhost:${PORT}`);
});
