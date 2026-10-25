'use strict';

const axios = require('axios');
const { Readable } = require('node:stream');

const AD_URL_PATTERN = /(distribrey\.com|agl00\d\.|bidster\.net|bracdn\.online|tds\.bid|yandex\.ru\/ads|adfox|googlesyndication\.com|doubleclick\.net|adhigh\.net|buzzoola\.com|mixadvert\.com|traforet\.com|adriver\.ru|betweendigital\.com|temptcdn\.com|getsdk\.online|vavada|1xbet|melbet|mostbet|rmp-vast|\/load-xml\/|\/vast\/|[?&]roll=(pre|mid|post))/i;

const EMPTY_VAST_XML = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

function buildClientShieldScript(targetUrl, proxyBasePath = '/api/player-proxy') {
  return `<script data-name="cinegram-ublock-shield">
(function() {
  var TARGET_URL = ${JSON.stringify(targetUrl)};
  var TARGET_ORIGIN = new URL(TARGET_URL).origin;
  var PROXY_PATH = ${JSON.stringify(proxyBasePath)};
  var ORIGINAL_ORIGIN = window.location.origin;
  var AD_RE = ${AD_URL_PATTERN.toString()};
  var EMPTY_VAST = ${JSON.stringify(EMPTY_VAST_XML)};

  // 1. Block all popups, popunders, and window.open ad redirects
  window.open = function() { return null; };
  window.__cgLogs = [];
  function cgLog(msg) {
    try {
      window.__cgLogs.push(String(msg).slice(0, 300));
      if (document.documentElement) {
        document.documentElement.setAttribute('data-cg-logs', JSON.stringify(window.__cgLogs.slice(-25)));
      }
    } catch (e) {}
  }
  ['warn', 'error', 'log'].forEach(function(k) {
    var orig = console[k];
    console[k] = function() {
      cgLog(k + ':' + Array.prototype.map.call(arguments, function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
      }).join(' '));
      return orig.apply(this, arguments);
    };
  });

  // 2. Strip ads from any JSON config parsed at runtime
  var origJsonParse = JSON.parse;
  JSON.parse = function(text, reviver) {
    var res = origJsonParse.call(this, text, reviver);
    try {
      if (res && typeof res === 'object') {
        if (res.ads && typeof res.ads === 'object') {
          res.ads.enabled = false;
          res.ads.preroll = '';
          res.ads.midroll = [];
          if (res.ads.replace) {
            res.ads.replace['[count_preroll]'] = 0;
            res.ads.replace['[count_midroll]'] = 0;
          }
        }
        if (Array.isArray(res.preroll)) res.preroll = [];
        if (Array.isArray(res.midroll)) res.midroll = [];
        if (res.dp_vast) res.dp_vast = false;
        if (res.vastConfig) {
          res.vastConfig.prerollCount = 0;
          res.vastConfig.midrollCount = 0;
        }
      }
    } catch (e) {}
    return res;
  };

  function resolveUrl(input) {
    try {
      var str = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
      if (str.indexOf(PROXY_PATH + '?') === 0) return ORIGINAL_ORIGIN + str;
      var resolved = new URL(str, TARGET_URL);
      if (resolved.origin === ORIGINAL_ORIGIN && resolved.pathname !== PROXY_PATH) {
        resolved = new URL(resolved.pathname + resolved.search, TARGET_ORIGIN);
      }
      return resolved.href;
    } catch (e) {
      return String(input || '');
    }
  }

  function needsProxy(fullUrl) {
    try {
      var u = new URL(fullUrl);
      // Media CDNs need the original player's Referer as well as its API host.
      return u.protocol === 'https:' && !(u.origin === ORIGINAL_ORIGIN && u.pathname === PROXY_PATH);
    } catch (e) { return false; }
  }

  function toProxyUrl(fullUrl) {
    var asset = new URL(fullUrl);
    var fragment = asset.hash;
    asset.hash = '';
    return ORIGINAL_ORIGIN + PROXY_PATH + '?url=' + encodeURIComponent(asset.href) + '&ref=' + encodeURIComponent(TARGET_URL) + '&sub=1' + fragment;
  }

  // SVG <use> loads do not pass through fetch/XHR. Player controls create
  // these nodes dynamically; keep the sprite on our origin and its symbol
  // fragment outside the proxy query string so the browser can resolve it.
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    var XLINK = 'http://www.w3.org/1999/xlink';
    function rewriteSprite(node) {
      if (!node || !node.getAttribute || String(node.localName).toLowerCase() !== 'use') return;
      var href = node.getAttribute('href');
      var legacyHref = node.getAttributeNS(XLINK, 'href');
      var value = href || legacyHref;
      if (!value || /^(?:#|data:|blob:)/i.test(value)) return;
      var fullUrl = resolveUrl(value);
      if (!needsProxy(fullUrl)) return;
      var proxied = toProxyUrl(fullUrl);
      if (href !== null) node.setAttribute('href', proxied);
      if (legacyHref !== null) node.setAttributeNS(XLINK, 'xlink:href', proxied);
    }
    function scanSprites(node) {
      rewriteSprite(node);
      if (node && node.querySelectorAll) node.querySelectorAll('svg use').forEach(rewriteSprite);
    }
    var spriteObserver = new MutationObserver(function(records) {
      records.forEach(function(record) {
        if (record.type === 'attributes') rewriteSprite(record.target);
        else record.addedNodes.forEach(scanSprites);
      });
    });
    spriteObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'xlink:href'] });
    scanSprites(document.documentElement);
  }

  // Keep Request method, body, headers and signal when changing its destination.
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var fullUrl = resolveUrl(input);
      if (fullUrl.indexOf('imasdk.googleapis.com/cekh8i') !== -1) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      if (AD_RE.test(fullUrl)) {
        return Promise.resolve(new Response(EMPTY_VAST, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }));
      }
      if (!needsProxy(fullUrl)) return origFetch.call(this, input, init);
      var proxyUrl = toProxyUrl(fullUrl);
      if (typeof Request !== 'undefined' && input instanceof Request) {
        var request = new Request(input, init);
        var options = { method: request.method, headers: request.headers, signal: request.signal,
          credentials: request.credentials, redirect: request.redirect, cache: request.cache };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return request.arrayBuffer().then(function(body) { options.body = body; return origFetch(proxyUrl, options); });
        }
        return origFetch(proxyUrl, options);
      }
      return origFetch.call(this, proxyUrl, init);
    };
  }

  // 4. Intercept XMLHttpRequest (blocks VAST XML requests & proxies player API calls)
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    var fullUrl = resolveUrl(url);
    this.__cgBlocked = AD_RE.test(fullUrl);
    if (this.addEventListener) this.addEventListener('loadend', function() {
      if (this.status >= 400 || this.status === 0) cgLog('xhr ' + this.status + ' ' + fullUrl.slice(0, 180));
    }, { once: true });
    if (this.__cgBlocked) {
      arguments[1] = 'data:application/xml;charset=utf-8,' + encodeURIComponent(EMPTY_VAST);
      return origOpen.apply(this, arguments);
    }
    if (needsProxy(fullUrl)) {
      arguments[1] = toProxyUrl(fullUrl);
    }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__cgBlocked) {
      return origSend.call(this, null);
    }
    return origSend.call(this, body);
  };

  // 5. Block click-jacking links with target="_blank"
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && (a.target === '_blank' || AD_RE.test(a.href || ''))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
</script>
<style data-name="cinegram-ublock-css">
  .rmp-ad-container, .vast-blocker, [id*="preroll_"], .ad-container, .ads-box, a[rel*="nofollow"][aria-hidden="true"] {
    display: none !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
  }
</style>`;
}

function cleanPlayerHtml(html, targetUrl) {
  const parsed = new URL(targetUrl);
  const origin = parsed.origin;
  let out = String(html || '');

  // 1. Fix Cloudflare Rocket Loader deferred scripts so they run normally
  out = out.replace(/type="[a-f0-9]+-text\/javascript"/gi, 'type="text/javascript"');
  out = out.replace(/<script[^>]+rocket-loader\.min\.js[^>]*><\/script>/gi, '');
  out = out.replace(/<script[^>]+temptcdn\.com[^>]*><\/script>/gi, '');

  // 2. Strip Subresource Integrity on cross-origin proxied scripts/styles
  out = out.replace(/\s+integrity="[^"]*"/gi, '');
  out = out.replace(/\s+crossorigin(?:="[^"]*")?/gi, '');

  // 3. Cinemar: strip preroll, midroll, vastConfig, dp_vast
  out = out.replace(/"vastConfig"\s*:\s*\{[^}]*\}/g, '"vastConfig":{"resetTime":0,"prerollCount":0,"midrollCount":0}');
  out = out.replace(/"preroll"\s*:\s*\[[\s\S]*?\](?=,"midroll")/g, '"preroll":[]');
  out = out.replace(/"midroll"\s*:\s*\[[\s\S]*?\](?=,"poster"|,"dp_vast")/g, '"midroll":[]');
  out = out.replace(/"dp_vast"\s*:\s*true/g, '"dp_vast":false');

  // 4. NextEmbed / Collaps / VenomPlayer: strip <script data-name="ad"> and adsConfig
  out = out.replace(/<script\s+data-name="ad">[\s\S]*?<\/script>/gi, '<script data-name="ad">var middleCount = 0, adTimeouts = {}, adsConfig = {};</script>');
  out = out.replace(/ads\s*:\s*adsConfig/g, 'ads: {}');
  // Prevent NextEmbed from redirecting out of the ad-free proxy frame
  out = out.replace(/if\s*\(\s*isEmbedded\s*&&\s*!sameOrigin\s*&&\s*window\.fetch/g, 'if (false && isEmbedded');

  // 5. Alloha / Stravers / Allarknow: disable rmp-vast, isFramed trap, and config.ads
  out = out.replace(/if\s*\(\s*!isFramed\s*\)/g, 'if(false)');
  out = out.replace(/<script[^>]+rmp-vast\.min\.js[^>]*><\/script>/gi, '<script>window.RmpVast=function(){};</script>');
  out = out.replace(/"ads"\s*:\s*\{"enabled"\s*:\s*true/g, '"ads":{"enabled":false');
  out = out.replace(/\\"ads\\"\s*:\s*\{\\"enabled\\"\s*:\s*true/g, '\\"ads\\":{\\"enabled\\":false');
  out = out.replace(/"\[count_preroll\]"\s*:\s*\d+/g, '"[count_preroll]":0');
  out = out.replace(/"\[count_midroll\]"\s*:\s*\d+/g, '"[count_midroll]":0');

  // Rewrite asset tags only in HTML, never strings inside inline JavaScript/JSON.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>|<(?:video|source|track|img)\b[^>]*>/gi, block => {
    const end = block.indexOf('>') + 1;
    const opening = block.slice(0, end).replace(/\b(src|href|poster)=["']([^"']+)["']/gi, (match, attr, value) => {
      if (/^(?:data:|blob:|#|\/api\/player-proxy)/i.test(value)) return match;
      try {
        const full = new URL(value.replace(/&amp;/g, '&'), targetUrl);
        if (full.protocol !== 'https:') return match;
        return attr + '="' + playerProxyUrl(full.href, targetUrl) + '"';
      } catch { return match; }
    });
    return opening + block.slice(end);
  });

  // 7. Inject the uBlock Client Shield at the very top of <head> (NO <base> tag so /api/player-proxy resolves to our server!)
  const injection = buildClientShieldScript(targetUrl);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, match => match + injection);
  } else {
    out = injection + out;
  }

  return out;
}

function playerProxyUrl(url, ref) {
  return '/api/player-proxy?url=' + encodeURIComponent(url) + '&ref=' + encodeURIComponent(ref) + '&sub=1';
}

function rewriteHlsManifest(text, manifestUrl, ref, proxyOrigin = '') {
  const rewrite = value => {
    if (/^(?:data:|blob:|skd:)/i.test(value)) return value;
    const url = new URL(value, manifestUrl);
    return url.protocol === 'https:' ? proxyOrigin + playerProxyUrl(url.href, ref) : value;
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.trim().startsWith('#')) {
      // Keys, audio/subtitle playlists, init segments and LL-HLS parts.
      return line.replace(/\bURI="([^"]+)"/g, (_, uri) => 'URI="' + rewrite(uri) + '"');
    }
    return rewrite(line.trim());
  }).join('\n');
}

async function readText(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) { stream.destroy(); throw new Error('Player document too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handlePlayerProxy(req, res) {
  let parsed, referer;
  try {
    parsed = new URL(req.query.url);
    referer = new URL(req.query.ref || 'https://lv.hdrezka.inc/');
    for (const url of [parsed, referer]) {
      if (url.protocol !== 'https:' || url.username || url.password) return res.status(400).send('Invalid url');
    }
  } catch { return res.status(400).send('Invalid url'); }

  if (AD_URL_PATTERN.test(parsed.href)) {
    return res.type('application/xml').status(200).send(EMPTY_VAST_XML);
  }
  const method = req.method.toUpperCase();
  if (!['GET', 'POST', 'HEAD'].includes(method)) return res.sendStatus(405);
  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers.accept || '*/*', 'Accept-Encoding': 'identity',
      'Accept-Language': 'ru,en;q=0.8', Referer: referer.href, Origin: referer.origin
    };
    for (const h of ['content-type', 'accepts-block', 'x-requested-with', 'range', 'if-range', 'borth', 'authorization']) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    // express.raw runs before JSON/form middleware, keeping signed payloads intact.
    const response = await axios({
      method, url: parsed.href, data: method === 'POST' ? req.body : undefined,
      responseType: 'stream', timeout: 20000, maxRedirects: 3,
      validateStatus: () => true, headers
    });
    if (process.env.PLAYER_PROXY_DEBUG === '1') console.log('[player-proxy]', method, response.status, parsed.hostname, parsed.pathname.slice(0, 100), response.headers['content-type']);
    const finalUrl = response.request?.res?.responseUrl || parsed.href;
    const contentType = String(response.headers['content-type'] || 'application/octet-stream');
    const isHtml = /text\/html/i.test(contentType);
    const isCss = /text\/css/i.test(contentType);
    let isHls = /(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/i.test(contentType)
      || /\.m3u8$/i.test(new URL(finalUrl).pathname);
    // Some CDNs serve extensionless HLS URLs as text/plain or octet-stream.
    if (!isHtml && !isCss && !isHls && response.status === 200 && method !== 'HEAD' && !/^video\//i.test(contentType)) {
      const upstream = response.data;
      const iterator = upstream[Symbol.asyncIterator]();
      const first = await iterator.next();
      isHls = !first.done && first.value.toString('utf8', 0, 32).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
      response.data = Readable.from((async function* () {
        if (!first.done) yield first.value;
        while (true) { const next = await iterator.next(); if (next.done) break; yield next.value; }
      })());
      response.data.on('close', () => upstream.destroy());
    }
    const transformed = response.status === 200 && method !== 'HEAD' && (isHtml || isCss || isHls);
    const skipHeaders = new Set(['transfer-encoding', 'content-encoding', 'connection', 'keep-alive',
      'x-frame-options', 'content-security-policy', 'alt-svc', 'set-cookie',
      'access-control-allow-origin', 'access-control-expose-headers', 'cache-control', 'content-length']);
    if (transformed) for (const key of ['content-length', 'etag', 'content-md5', 'content-range']) skipHeaders.add(key);
    for (const [key, value] of Object.entries(response.headers)) {
      if (!skipHeaders.has(key.toLowerCase()) && value !== undefined) res.setHeader(key, value);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    // Manifests/configs contain short-lived signatures and must not be reused.
    res.setHeader('Cache-Control', 'no-store');
    if (transformed) {
      const body = await readText(response.data);
      if (isHls) {
        res.type('application/vnd.apple.mpegurl');
        return res.status(response.status).send(rewriteHlsManifest(body, finalUrl, referer.href, (req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol) + '://' + req.get('host')));
      }
      if (isHtml) {
        res.type('html');
        return res.status(response.status).send(cleanPlayerHtml(body, finalUrl));
      }
      const css = body.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, quote, uri) => {
        if (/^(?:data:|blob:|#|\/api\/player-proxy)/i.test(uri)) return match;
        try { return 'url("' + playerProxyUrl(new URL(uri, finalUrl).href, referer.href) + '")'; }
        catch { return match; }
      });
      res.type('css');
      return res.status(response.status).send(css);
    }
    res.status(response.status);
    // Stream video/segments and preserve 206 + Content-Range for seeking.
    response.data.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
    res.on('close', () => response.data.destroy());
    response.data.pipe(res);
  } catch (error) {
    console.error('[player-proxy] Error:', error.message);
    if (!res.headersSent) res.status(502).send('Ошибка загрузки прокси плеера');
    else res.destroy();
  }
}

module.exports = { cleanPlayerHtml, handlePlayerProxy, AD_URL_PATTERN, rewriteHlsManifest, buildClientShieldScript };
