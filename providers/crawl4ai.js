'use strict';
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { existsSync } = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const cheerio = require('cheerio');

const root = path.join(__dirname, '..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const ALLOWED_HOSTS = new Set(['lv.hdrezka.inc', 'rezka.fi', 'rezka.si', 'go3.kinogo.cc', 'kinogo.la']);

let worker;
let sequence = 0;
let pythonAvailable = Boolean(process.env.CRAWL4AI_PYTHON || existsSync(localPython));
const waiting = new Map();

function extractWithCheerio(kind, html) {
  if (!html.includes('id="dle-content"') && !html.includes("id='dle-content'")) {
    throw Object.assign(new Error('Источник вернул страницу входа или проверки доступа'), { status: 502 });
  }
  const $ = cheerio.load(html);
  if (kind === 'catalog') {
    const rows = [];
    $('#dle-content .postItem').each((_, el) => {
      const node = $(el);
      rows.push({
        title: node.find('.postTitle a').first().text().trim(),
        href: node.find('.postTitle a').first().attr('href') || '',
        poster: node.find('img.poster').first().attr('data-src') || '',
        posterFallback: node.find('img.poster').first().attr('src') || '',
        info: node.find('.misc').first().text().trim()
      });
    });
    return rows;
  }
  if (kind === 'movie') {
    const rows = [];
    $('#dle-content .innerPost').each((_, el) => {
      const node = $(el);
      const actorNames = [];
      node.find('.infoData:has(.cast) .personLink').each((__, a) => {
        actorNames.push({ name: $(a).text().trim() });
      });
      const info = [];
      node.find('.post__info tr').each((__, tr) => {
        const row = $(tr);
        const links = [];
        row.find('td:nth-child(2) a').each((___, a) => {
          links.push({ name: $(a).text().trim() });
        });
        info.push({
          key: row.find('td:first-child').text().trim(),
          value: row.find('td:nth-child(2)').text().trim(),
          links
        });
      });
      const players = [];
      node.find('.playerWrap .player-tabs [data-src], .playerWrap .player-container iframe').each((__, p) => {
        const item = $(p);
        players.push({
          name: item.text().trim(),
          url: item.attr('data-src') || '',
          src: item.attr('src') || ''
        });
      });
      rows.push({
        title: node.find('h1').first().text().trim(),
        originalTitle: node.find('.altName').first().text().trim(),
        poster: node.find('.postImg img').first().attr('src') || '',
        description: node.find('.postText').first().text().trim(),
        descriptionHeading: node.find('.postText h2').first().text().trim(),
        actors: node.find('.infoData:has(.cast)').first().text().trim(),
        actorNames,
        ratingKp: node.find('.b-post__info_rates.kp .bold').first().text().trim(),
        ratingImdb: node.find('.b-post__info_rates.imdb .bold').first().text().trim(),
        info,
        players
      });
    });
    return rows;
  }
  if (kind === 'kinogo_search') {
    const rows = [];
    $('#dle-content .movie').each((_, el) => {
      const node = $(el);
      const info = [];
      node.find('.movie__info-item').each((__, item) => {
        const it = $(item);
        info.push({
          key: it.find('b').first().text().trim(),
          value: it.text().trim()
        });
      });
      rows.push({
        title: node.find('.shortstorytitle h2 a').first().text().trim(),
        href: node.find('.shortstorytitle h2 a').first().attr('href') || '',
        info
      });
    });
    return rows;
  }
  if (kind === 'kinogo_movie') {
    const node = $('#dle-content').first();
    if (!node.length) return [];
    const tabs = [];
    node.find('.player-tabs li').each((_, li) => {
      tabs.push({ name: $(li).text().trim() });
    });
    const players = [];
    node.find('#preroll .box iframe').each((_, ifr) => {
      const item = $(ifr);
      players.push({
        url: item.attr('data-src') || '',
        src: item.attr('src') || ''
      });
    });
    return [{
      title: node.find('.movie h1').first().text().trim(),
      ldJson: node.find('script[type="application/ld+json"]').first().html() || '',
      tabs,
      players
    }];
  }
  throw Object.assign(new Error('Неизвестный тип страницы'), { status: 400 });
}

async function crawlFallback(url, kind) {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw Object.assign(new Error('Недопустимый адрес источника'), { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw Object.assign(new Error('Недопустимый адрес источника'), { status: 400 });
  }
  const response = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 0,
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru,en;q=0.8' }
  });
  return extractWithCheerio(kind, String(response.data || ''));
}

function stopWorker() {
  const child = worker;
  worker = null;
  if (child) child.kill();
  for (const task of waiting.values()) {
    clearTimeout(task.timer);
    task.reject(new Error('Парсер Crawl4AI остановлен.'));
  }
  waiting.clear();
}

function startWorker() {
  if (worker) return worker;
  const python = process.env.CRAWL4AI_PYTHON || (existsSync(localPython) ? localPython : 'python3');
  const child = spawn(python, ['-u', path.join(root, 'crawler/worker.py')], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });
  worker = child;
  child.stderr.on('data', data => process.stderr.write(data));
  child.stdin.on('error', () => { if (worker === child) stopWorker(); });
  child.on('error', () => { pythonAvailable = false; if (worker === child) stopWorker(); });
  child.on('exit', (code) => { if (code !== 0) pythonAvailable = false; if (worker === child) stopWorker(); });
  createInterface({ input: child.stdout }).on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const task = waiting.get(response.id);
    if (!task) return;
    waiting.delete(response.id); clearTimeout(task.timer);
    if (response.error) task.reject(Object.assign(new Error(response.error), { status: response.status || 502 }));
    else task.resolve(response.data);
  });
  return child;
}

function crawl(url, kind) {
  if (!pythonAvailable || process.env.VERCEL) {
    return crawlFallback(url, kind);
  }
  if (waiting.size >= 8) return Promise.reject(Object.assign(new Error('Парсер занят. Попробуйте снова.'), { status: 503 }));
  const child = startWorker();
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => stopWorker(), 25000);
    waiting.set(id, {
      resolve,
      reject: (err) => {
        if (!pythonAvailable) {
          crawlFallback(url, kind).then(resolve, reject);
        } else {
          reject(err);
        }
      },
      timer
    });
    child.stdin.write(JSON.stringify({ id, url, kind }) + '\n');
  });
}

process.once('exit', () => { if (worker) worker.kill(); });
module.exports = { crawl, stopWorker };
