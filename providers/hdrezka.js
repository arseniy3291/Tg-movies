'use strict';

const axios = require('axios');
const { crawl } = require('./crawl4ai');
const ORIGIN = 'https://lv.hdrezka.inc';
const GENRES = { 1: 'triller', 2: 'drama', 3: 'kriminal', 4: 'melodrama', 6: 'fantastika', 11: 'boevik', 12: 'prikljuchenija', 13: 'komedija', 17: 'uzhasy' };
const cache = new Map();
const pending = new Map();
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function moviePath(value) {
  if (typeof value !== 'string' || !/^\/(filmy|serialy|multfilmy|multserial|anime)\/\d+-[a-z0-9-]+\.html$/.test(value)) {
    throw new ProviderError('Неверная ссылка на фильм HDRezka', 400);
  }
  return value;
}

function movieId(path) { return 'hd_' + Buffer.from(moviePath(path)).toString('base64url'); }
function decodeId(id) {
  if (typeof id !== 'string' || !/^hd_[A-Za-z0-9_-]{1,600}$/.test(id)) throw new ProviderError('Неверный ID', 400);
  const path = moviePath(Buffer.from(id.slice(3), 'base64url').toString('utf8'));
  if (movieId(path) !== id) throw new ProviderError('Неверный ID', 400);
  return path;
}

function safeUrl(value, base = ORIGIN) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

function posterUrl(value) {
  const url = safeUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || !parsed.pathname.startsWith('/uploads/')) return '';
  return '/api/hdrezka/image?path=' + encodeURIComponent(parsed.pathname);
}

async function request(path, image = false) {
  try {
    const response = await axios.get(ORIGIN + path, {
      timeout: 12000, maxRedirects: 0, maxContentLength: image ? 8 * 1024 * 1024 : 3 * 1024 * 1024,
      responseType: image ? 'arraybuffer' : 'text',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: image ? 'image/*' : 'text/html', Referer: ORIGIN + '/' }
    });
    return response;
  } catch (error) {
    const status = error.response?.status;
    throw new ProviderError(status === 404 ? 'Страница HDRezka не найдена' :
      status === 403 ? 'HDRezka временно ограничивает доступ. Попробуйте позже.' : 'HDRezka сейчас недоступна', status === 404 ? 404 : 502);
  }
}

async function extracted(path, kind) {
  const key = kind + ':' + path;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.data;
  if (pending.has(key)) return pending.get(key);
  const job = crawl(ORIGIN + path, kind).then(data => {
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { data, until: Date.now() + 120000 });
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

function mapCatalog(items) {
  const cards = [];
  for (const item of items) {
    const url = safeUrl(item.href);
    if (!url || new URL(url).origin !== ORIGIN) continue;
    let id;
    try { id = movieId(new URL(url).pathname); } catch { continue; }
    if (cards.some(card => card.id === id)) continue;
    cards.push({ id, provider: 'hdrezka', title: clean(item.title),
      poster: posterUrl(item.poster || item.posterFallback),
      info: clean(item.info), rating: '', url: '/movie/' + id });
  }
  return cards;
}

function mapSources(players = []) {
  const sources = [];
  for (const player of players) {
    const url = safeUrl(player.url || player.src);
    if (!url || sources.some(s => s.url === url)) continue;
    const label = clean(player.name);
    const trailer = /трейлер/i.test(label) || /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(url).hostname);
    sources.push({ source: 'hdrezka', name: trailer ? 'Трейлер' : 'HDRezka · ' + (label || 'Плеер'), type: 'iframe', url, trailer });
  }
  return sources;
}

function mapMovie(items, path) {
  const item = items[0];
  if (!item?.title) throw new ProviderError('Не удалось прочитать карточку HDRezka');
  const info = Object.fromEntries((item.info || []).map(row => [clean(row.key).replace(/:$/, '').trim(), row.links?.length ? row.links.map(link => clean(link.name)).join(', ') : clean(row.value)]));
  const id = movieId(path);
  const rating = [item.ratingKp, item.ratingImdb].map(Number).find(n => n > 0);
  return { id, provider: 'hdrezka', title: clean(item.title), originalTitle: clean(item.originalTitle),
    description: clean(item.description).replace(clean(item.descriptionHeading), '').trim(), poster: posterUrl(item.poster),
    year: info['Дата выхода'] || '', genre: info['Жанр'] || '', countries: info['Страна'] || '',
    directors: info['Режиссер'] || '', actors: item.actorNames?.length ? item.actorNames.map(actor => clean(actor.name)).join(', ') : clean(item.actors).replace(/^В ролях актеры:/, '').trim(), length: info['Время'] || '',
    rating: rating ? String(rating) : '', url: '/movie/' + id, sourceUrl: ORIGIN + path,
    videoSources: mapSources(item.players),
    kinogo: { status: 'external', url: 'https://go3.kinogo.cc/', message: 'Kinogo требует проверки доступа. Найдите фильм на сайте; встроенный плеер пока недоступен.' }
  };
}

function pageNumber(value) {
  const page = Number(value || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ProviderError('Неверная страница', 400);
  return page;
}

async function catalog({ type = 'films', genre = '', page = 1 } = {}) {
  if (!['films', 'series'].includes(type)) throw new ProviderError('Неизвестный раздел', 400);
  if (genre && !GENRES[genre]) throw new ProviderError('Неизвестный жанр', 400);
  const section = type === 'series' ? 'serialy' : 'filmy';
  let path = '/' + section + '/';
  if (genre) path += (type === 'series' ? 'serialy-' : '') + GENRES[genre] + '/';
  page = pageNumber(page);
  if (page > 1) path += 'page/' + page + '/';
  return mapCatalog(await extracted(path, 'catalog'));
}

async function search({ q = '', page = 1 } = {}) {
  if (typeof q !== 'string' || q.length > 200) throw new ProviderError('Некорректный поисковый запрос', 400);
  q = q.trim();
  if (!q) return [];
  page = pageNumber(page);
  const params = new URLSearchParams({ do: 'search', subaction: 'search', story: q });
  const path = page === 1 ? '/index.php?' + params : '/search/' + encodeURIComponent(q) + '/page/' + page + '/';
  return mapCatalog(await extracted(path, 'catalog'));
}

async function movie(id) { const path = decodeId(id); return mapMovie(await extracted(path, 'movie'), path); }

const KINOGO_ORIGIN = 'https://kinogo.la';

function normTitle(value) {
  return clean(value).toLowerCase().replace(/ё/g, 'е').replace(/\(\d{4}[^)]*\)/g, '').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

function mapKinogoSources(item = {}) {
  const tabs = (item.tabs || []).map(t => clean(t.name));
  const players = item.players || [];
  const sources = [];
  players.forEach((p, idx) => {
    const url = safeUrl(p.url || p.src, KINOGO_ORIGIN);
    if (!url || sources.some(s => s.url === url)) return;
    const label = tabs[idx] || `Плеер ${idx + 1}`;
    const trailer = /трейлер|trailer/i.test(label) || /\/trailer\//i.test(url);
    sources.push({
      source: 'kinogo',
      name: trailer ? 'Kinogo · Трейлер' : `Kinogo · ${label}`,
      type: 'iframe',
      url,
      trailer
    });
  });
  return sources;
}

async function resolveHdrezkaByTitle(title, year) {
  const q = clean(title);
  if (!q) return { sources: [], url: '' };
  const params = new URLSearchParams({ do: 'search', subaction: 'search', story: q });
  const items = await extracted('/index.php?' + params, 'catalog').catch(() => []);
  const target = normTitle(q);
  const yearStr = String(year || '').slice(0, 4);

  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const href = safeUrl(item.href, ORIGIN);
    if (!href || new URL(href).origin !== ORIGIN) continue;
    const itemNorm = normTitle(item.title);
    let score = 0;
    if (itemNorm === target) score += 10;
    else if (itemNorm.includes(target) || target.includes(itemNorm)) score += 5;
    if (yearStr && String(item.info || '').includes(yearStr)) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = new URL(href).pathname;
    }
  }
  if (!best || bestScore < 4) return { sources: [], url: ORIGIN + '/index.php?' + params };
  const detailItems = await extracted(best, 'movie').catch(() => []);
  if (!detailItems.length) return { sources: [], url: ORIGIN + best };
  return {
    sources: mapSources(detailItems[0].players),
    url: ORIGIN + best
  };
}

async function resolveKinogoByTitle(title, year) {
  const q = clean(title);
  if (!q) return { sources: [], url: KINOGO_ORIGIN };
  const params = new URLSearchParams({ do: 'search', subaction: 'search', story: q });
  const searchPath = '/index.php?' + params.toString();
  const key = 'kinogo_search:' + searchPath;
  let items = cache.get(key)?.until > Date.now() ? cache.get(key).data : null;
  if (!items) {
    items = await crawl(KINOGO_ORIGIN + searchPath, 'kinogo_search').catch(() => []);
    cache.set(key, { data: items, until: Date.now() + 120000 });
  }
  const target = normTitle(q);
  const yearStr = String(year || '').slice(0, 4);

  let bestUrl = '';
  let bestScore = -1;
  for (const item of items || []) {
    const href = safeUrl(item.href, KINOGO_ORIGIN);
    if (!href || new URL(href).origin !== KINOGO_ORIGIN) continue;
    const itemNorm = normTitle(item.title);
    let score = 0;
    if (itemNorm === target) score += 10;
    else if (itemNorm.includes(target) || target.includes(itemNorm)) score += 5;
    const infoText = (item.info || []).map(r => r.value || '').join(' ') + ' ' + (item.title || '');
    if (yearStr && infoText.includes(yearStr)) score += 4;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = href;
    }
  }
  if (!bestUrl || bestScore < 4) {
    return { sources: [], url: KINOGO_ORIGIN + searchPath };
  }
  const mKey = 'kinogo_movie:' + bestUrl;
  let mItems = cache.get(mKey)?.until > Date.now() ? cache.get(mKey).data : null;
  if (!mItems) {
    mItems = await crawl(bestUrl, 'kinogo_movie').catch(() => []);
    cache.set(mKey, { data: mItems, until: Date.now() + 120000 });
  }
  return {
    sources: mItems?.length ? mapKinogoSources(mItems[0]) : [],
    url: bestUrl
  };
}

async function resolveSources({ title = '', originalTitle = '', year = '' } = {}) {
  const query = clean(title || originalTitle);
  const [hdr, kng] = await Promise.all([
    resolveHdrezkaByTitle(query, year),
    resolveKinogoByTitle(query, year)
  ]);

  const combined = [...(kng.sources || []), ...(hdr.sources || [])];
  // Put full players first, trailers last
  combined.sort((a, b) => Number(Boolean(a.trailer)) - Number(Boolean(b.trailer)));

  return {
    sources: combined,
    hdrezkaUrl: hdr.url || ORIGIN,
    kinogoUrl: kng.url || KINOGO_ORIGIN
  };
}

module.exports = { catalog, search, movie, request, mapCatalog, mapMovie, movieId, decodeId, resolveSources, ProviderError };
