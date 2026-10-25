'use strict';

const axios = require('axios');

const AD_URL_PATTERN = /(distribrey\.com|agl00\d\.|bidster\.net|bracdn\.online|tds\.bid|yandex\.ru\/ads|adfox|googlesyndication\.com|doubleclick\.net|adhigh\.net|buzzoola\.com|mixadvert\.com|traforet\.com|adriver\.ru|betweendigital\.com|temptcdn\.com|getsdk\.online|vavada|1xbet|melbet|mostbet|rmp-vast|\/load-xml\/|\/vast\/|[?&]roll=(pre|mid|post))/i;

const EMPTY_VAST_XML = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

function buildClientShieldScript(targetOrigin, proxyBasePath = '/api/player-proxy') {
  return `<script data-name="cinegram-ublock-shield">
(function() {
  var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  var PROXY_PATH = ${JSON.stringify(proxyBasePath)};
  var ORIGINAL_ORIGIN = window.location.origin;
  var AD_RE = ${AD_URL_PATTERN.toString()};
  var EMPTY_VAST = ${JSON.stringify(EMPTY_VAST_XML)};

  // 1. Block all popups, popunders, and window.open ad redirects
  window.open = function() { return null; };

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
      return new URL(str, TARGET_ORIGIN).href;
    } catch (e) {
      return String(input || '');
    }
  }

  function needsProxy(fullUrl) {
    try {
      var u = new URL(fullUrl);
      var t = new URL(TARGET_ORIGIN);
      return u.origin === t.origin;
    } catch (e) {
      return false;
    }
  }

  function toProxyUrl(fullUrl) {
    return ORIGINAL_ORIGIN + PROXY_PATH + '?url=' + encodeURIComponent(fullUrl) + '&ref=' + encodeURIComponent(TARGET_ORIGIN + '/') + '&sub=1';
  }

  // 3. Intercept fetch (uBlock-style network filter + same-origin proxy routing)
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var fullUrl = resolveUrl(input);
      // Anti-adblock bait check on stravers/alloha: return clean 404 like real server
      if (fullUrl.indexOf('imasdk.googleapis.com/cekh8i') !== -1) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      if (AD_RE.test(fullUrl)) {
        return Promise.resolve(new Response(EMPTY_VAST, {
          status: 200,
          headers: { 'Content-Type': 'application/xml; charset=utf-8' }
        }));
      }
      if (needsProxy(fullUrl)) {
        return origFetch.call(this, toProxyUrl(fullUrl), init);
      }
      return origFetch.call(this, input, init);
    };
  }

  // 4. Intercept XMLHttpRequest (blocks VAST XML requests & proxies player API calls)
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    var fullUrl = resolveUrl(url);
    this.__cgBlocked = AD_RE.test(fullUrl);
    if (this.__cgBlocked) {
      return origOpen.call(this, 'GET', 'data:application/xml;charset=utf-8,' + encodeURIComponent(EMPTY_VAST), true);
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
  out = out.replace(/"midroll"\s*:\s*\[[\s\S]*?\](?=,"dp_vast")/g, '"midroll":[]');
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

  // 6. Rewrite relative and protocol-relative asset paths ONLY inside <script> and <link> opening tags
  out = out.replace(/<(script|link)\b[^>]*>/gi, (tag) => {
    return tag.replace(/\b(src|href)=["']([^"']+)["']/gi, (attrMatch, attr, val) => {
      if (val.startsWith('/api/player-proxy') || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('#')) {
        return attrMatch;
      }
      let full = null;
      if (val.startsWith('//')) {
        full = 'https:' + val;
      } else if (val.startsWith('/')) {
        full = origin + val;
      } else if (val.startsWith('./')) {
        full = new URL(val, targetUrl).href;
      }
      if (!full) return attrMatch;
      return `${attr}="/api/player-proxy?url=${encodeURIComponent(full)}&ref=${encodeURIComponent(origin + '/')}&sub=1"`;
    });
  });

  // 7. Inject the uBlock Client Shield at the very top of <head> (NO <base> tag so /api/player-proxy resolves to our server!)
  const injection = buildClientShieldScript(origin);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, match => match + injection);
  } else {
    out = injection + out;
  }

  return out;
}

async function handlePlayerProxy(req, res) {
  const rawUrl = req.query.url;
  const ref = req.query.ref || 'https://lv.hdrezka.inc/';
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).send('Missing url');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return res.status(400).send('Invalid url');
    }
  } catch {
    return res.status(400).send('Invalid url');
  }

  if (AD_URL_PATTERN.test(rawUrl)) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(EMPTY_VAST_XML);
  }

  try {
    const method = req.method === 'POST' ? 'POST' : 'GET';
    const isSub = req.query.sub === '1';
    const effectiveRef = isSub ? (parsed.origin + '/') : ref;
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': 'ru,en;q=0.8',
      'Referer': effectiveRef,
      'Origin': new URL(effectiveRef).origin
    };
    for (const h of ['content-type', 'accepts-block', 'x-requested-with', 'range']) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }

    const response = await axios({
      method,
      url: parsed.href,
      data: method === 'POST' ? req.body : undefined,
      responseType: 'arraybuffer',
      timeout: 12000,
      maxRedirects: 3,
      validateStatus: () => true,
      headers
    });

    const contentType = String(response.headers['content-type'] || 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (/text\/html/i.test(contentType)) {
      const html = Buffer.from(response.data).toString('utf8');
      const cleaned = cleanPlayerHtml(html, parsed.href);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(response.status).send(cleaned);
    }

    if (/text\/css/i.test(contentType)) {
      let css = Buffer.from(response.data).toString('utf8');
      css = css.replace(/url\(\s*(['"]?)(\/(?!\/|api\/player-proxy)[^)'"]+)\1\s*\)/gi, (_, q, relPath) => {
        const full = parsed.origin + relPath;
        return `url(${q}/api/player-proxy?url=${encodeURIComponent(full)}&ref=${encodeURIComponent(parsed.origin + '/')}&sub=1${q})`;
      });
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(response.status).send(css);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(response.status).send(Buffer.from(response.data));
  } catch (err) {
    console.error('[player-proxy] Error:', err.message);
    return res.status(502).send('Ошибка загрузки прокси плеера');
  }
}

module.exports = { cleanPlayerHtml, handlePlayerProxy, AD_URL_PATTERN };
