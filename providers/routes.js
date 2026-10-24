'use strict';
const express = require('express');
const hdrezka = require('./hdrezka');
const router = express.Router();
const handle = fn => async (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); res.json(await fn(req)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
};

router.get('/popular', handle(req => hdrezka.catalog(req.query)));
router.get('/discover', handle(req => hdrezka.catalog(req.query)));
router.get('/search', handle(req => hdrezka.search(req.query)));
router.get('/movie', (req, res, next) => {
  const id = String(req.query.id || req.query.url || '').split('/').pop();
  if (!id.startsWith('hd_')) return next(); // Existing Kinopoisk bookmarks keep their original IDs.
  return handle(() => hdrezka.movie(id))(req, res);
});
router.get('/hdrezka/image', async (req, res) => {
  const path = req.query.path;
  if (typeof path !== 'string' || !/^\/uploads\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp)$/i.test(path)) return res.sendStatus(400);
  try {
    const response = await hdrezka.request(path, true);
    const type = response.headers['content-type'] || '';
    if (!/^image\/(jpeg|png|webp)(;|$)/i.test(type)) return res.sendStatus(502);
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400').send(Buffer.from(response.data));
  } catch { res.sendStatus(502); }
});
module.exports = router;
