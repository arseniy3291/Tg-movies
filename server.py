import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import threading
import ssl

PORT = 3000
KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86'
PUBLIC_DIR = os.path.join(os.getcwd(), 'public')

# ═══════════════════════════════════════════════════════════════
# In-memory image cache to avoid re-fetching the same posters
# ═══════════════════════════════════════════════════════════════
_img_cache = {}
_img_cache_lock = threading.Lock()
MAX_CACHE = 300  # max cached images

def cached_fetch_image(url):
    """Fetch image with in-memory cache."""
    with _img_cache_lock:
        if url in _img_cache:
            return _img_cache[url]

    req = urllib.request.Request(url)
    req.add_header('X-API-KEY', KP_KEY)
    req.add_header('Referer', 'https://www.kinopoisk.ru/')
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
        data = resp.read()
        ctype = resp.info().get_content_type() or 'image/jpeg'

    with _img_cache_lock:
        if len(_img_cache) >= MAX_CACHE:
            # Evict oldest ~50 entries
            keys = list(_img_cache.keys())[:50]
            for k in keys:
                del _img_cache[k]
        _img_cache[url] = (data, ctype)

    return data, ctype


def kp_fetch(url_path):
    """Fetch JSON from Kinopoisk Unofficial API."""
    url = f"https://kinopoiskapiunofficial.tech{url_path}"
    req = urllib.request.Request(url)
    req.add_header('X-API-KEY', KP_KEY)
    req.add_header('User-Agent', 'Mozilla/5.0')
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
        return json.loads(resp.read().decode('utf-8'))


def is_real_rating(val):
    """Checks if the rating value is a real number (not a dash, None, or null)."""
    if not val:
        return False
    s = str(val).strip()
    if s in ('', 'None', 'null', '—', '-', '0.0', '0'):
        return False
    try:
        # Check if it's a percentage (e.g. "98%")
        if s.endswith('%'):
            return False # ratingAwait is usually percentage, which means unreleased
        float(s)
        return True
    except ValueError:
        return False


def map_card(item, exclude_unreleased=False):
    """Map Kinopoisk item to our card format. If exclude_unreleased is True, returns None for movies without a rating."""
    # Check if movie has any real rating
    kp_rating = item.get('ratingKinopoisk') or item.get('rating')
    imdb_rating = item.get('ratingImdb')
    
    has_real_rating = is_real_rating(kp_rating) or is_real_rating(imdb_rating)
    
    # If we are filtering and there's no real rating, skip it
    if exclude_unreleased and not has_real_rating:
        return None

    raw_poster = item.get('posterUrlPreview') or item.get('posterUrl') or ''
    if not raw_poster or 'no-poster.png' in raw_poster:
        return None

    id_val = str(item.get('kinopoiskId') or item.get('filmId'))
    title = item.get('nameRu') or item.get('nameOriginal') or item.get('nameEn') or 'Без названия'
    poster = f"/api/image?url={urllib.parse.quote(raw_poster)}"

    genres = item.get('genres', [])
    genre_str = ", ".join([g.get('genre', '') for g in genres[:2]])
    parts = []
    if item.get('year'):
        parts.append(str(item['year']))
    if genre_str:
        parts.append(genre_str)
    info = ", ".join(parts)

    raw_rating = item.get('ratingKinopoisk') or item.get('rating') or item.get('ratingImdb') or item.get('ratingAwait') or ''
    rating_display = ''
    if raw_rating:
        try:
            if isinstance(raw_rating, str) and raw_rating.endswith('%'):
                rating_display = f"{float(raw_rating.strip('%')) / 10:.1f}"
            else:
                r = float(raw_rating)
                if r > 0:
                    rating_display = f"{r:.1f}"
        except:
            rating_display = str(raw_rating) if str(raw_rating) != 'null' else ''

    return {
        'id': id_val,
        'title': title,
        'poster': poster,
        'info': info,
        'rating': rating_display,
        'url': f"/movie/{id_val}"
    }


class CineGramHandler(http.server.SimpleHTTPRequestHandler):
    """Optimized request handler."""

    # Suppress default logging for image requests (too noisy)
    def log_message(self, format, *args):
        path = args[0] if args else ''
        if '/api/image' in str(path):
            return  # silence image proxy logs
        super().log_message(format, *args)

    def translate_path(self, path):
        path = super().translate_path(path)
        rel_path = os.path.relpath(path, os.getcwd())
        return os.path.join(PUBLIC_DIR, rel_path)

    def do_GET(self):
        url_parts = urllib.parse.urlparse(self.path)
        path = url_parts.path
        query = urllib.parse.parse_qs(url_parts.query)

        if path.startswith('/api/'):
            try:
                self.handle_api(path, query)
            except BrokenPipeError:
                pass  # Client disconnected, ignore
            except Exception as e:
                try:
                    self.send_json({'error': str(e)}, status=500)
                except:
                    pass
        else:
            full_path = self.translate_path(path)
            if not os.path.exists(full_path) or os.path.isdir(full_path):
                self.path = '/index.html'
            super().do_GET()

    def handle_api(self, path, query):
        if path == '/api/image':
            self.proxy_image(query.get('url', [None])[0])
        elif path == '/api/popular':
            self.api_popular(query)
        elif path == '/api/search':
            self.api_search(query)
        elif path == '/api/discover':
            self.api_discover(query)
        elif path == '/api/movie':
            self.api_movie(query)
        elif path == '/api/video-sources':
            self.api_video_sources(query)
        else:
            self.send_error(404)

    # ─── Image Proxy (cached) ────────────────────────────────
    def proxy_image(self, img_url):
        if not img_url:
            self.send_error(400)
            return
        try:
            data, ctype = cached_fetch_image(img_url)
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'public, max-age=604800')
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_error(502)

    # ─── Popular ─────────────────────────────────────────────
    def api_popular(self, query):
        m_type = query.get('type', ['films'])[0]
        page = query.get('page', ['1'])[0]

        if m_type == 'series':
            kp_path = f"/api/v2.2/films/collections?type=TOP_250_TV_SHOWS&page={page}"
        elif m_type == 'cartoons':
            kp_path = f"/api/v2.2/films?genres=18&order=NUM_VOTE&type=ALL&ratingFrom=7&yearFrom=2015&page={page}"
        else:
            kp_path = f"/api/v2.2/films/collections?type=TOP_POPULAR_MOVIES&page={page}"

        data = kp_fetch(kp_path)
        items = [map_card(i, exclude_unreleased=True) for i in data.get('items', [])]
        self.send_json([i for i in items if i])

    # ─── Search ──────────────────────────────────────────────
    def api_search(self, query):
        q = query.get('q', [''])[0].lower()
        genre = query.get('genre', [''])[0]
        year = query.get('year', [''])[0]
        page = query.get('page', ['1'])[0]

        if not q and not genre and not year:
            self.send_json([])
            return

        if not genre and not year and q:
            data = kp_fetch(f"/api/v2.1/films/search-by-keyword?keyword={urllib.parse.quote(q)}&page={page}")
            items = [map_card(i) for i in data.get('films', [])]
        else:
            kp_url = f"/api/v2.2/films?page={page}"
            if q:
                kp_url += f"&keyword={urllib.parse.quote(q)}"
            if genre:
                kp_url += f"&genres={genre}"
            if year:
                if '-' in year:
                    y_from, y_to = year.split('-', 1)
                    kp_url += f"&yearFrom={y_from}&yearTo={y_to}"
                else:
                    kp_url += f"&yearFrom={year}&yearTo={year}"
            data = kp_fetch(kp_url)
            items = [map_card(i) for i in data.get('items', [])]

        self.send_json([i for i in items if i])

    # ─── Discover ────────────────────────────────────────────
    def api_discover(self, query):
        genre = query.get('genre', [''])[0]
        page = query.get('page', ['1'])[0]
        data = kp_fetch(f"/api/v2.2/films?genres={urllib.parse.quote(genre)}&order=RATING&type=ALL&ratingFrom=7&page={page}")
        items = [map_card(i, exclude_unreleased=True) for i in data.get('items', [])]
        self.send_json([i for i in items if i])

    # ─── Movie Detail ────────────────────────────────────────
    def api_movie(self, query):
        url_str = query.get('url', [''])[0]
        movie_id = url_str.split('/')[-1]
        if not movie_id:
            self.send_error(400)
            return

        data = kp_fetch(f"/api/v2.2/films/{movie_id}")

        directors = []
        actors = []
        try:
            staff = kp_fetch(f"/api/v1/staff?filmId={movie_id}")
            if isinstance(staff, list):
                directors = [s.get('nameRu') or s.get('nameEn', '') for s in staff if s.get('professionKey') == 'DIRECTOR'][:2]
                actors = [s.get('nameRu') or s.get('nameEn', '') for s in staff if s.get('professionKey') == 'ACTOR'][:6]
        except:
            pass

        # Fetch video sources
        sources = []
        kp_id = str(data.get('kinopoiskId'))
        title = data.get('nameRu') or data.get('nameOriginal') or ''
        year = str(data.get('year', ''))

        if kp_id:
            sources.append({
                'source': 'alloha',
                'name': 'Источник 1 (Alloha)',
                'url': f"https://alloha.tv/player/index.php?kp={kp_id}"
            })
            sources.append({
                'source': 'bazon',
                'name': 'Источник 2 (Bazon)',
                'url': f"https://bazon.cc/video/embed/kp/{kp_id}"
            })
            sources.append({
                'source': 'kinohub',
                'name': 'Источник 3 (Mirror)',
                'url': f"https://on.kinohub.vip/embed/kp/{kp_id}",
                'clipped': True
            })

        if title:
            q = urllib.parse.quote(f"{title} {year}".strip())
            sources.append({
                'source': 'videocdn',
                'name': 'Источник 4 (CDN)',
                'url': f"https://videocdn.tv/api/embed/movie?title={q}"
            })

        self.send_json({
            'id': kp_id,
            'title': data.get('nameRu') or data.get('nameOriginal') or 'Без названия',
            'description': data.get('description') or data.get('shortDescription') or 'Нет описания',
            'poster': f"/api/image?url={urllib.parse.quote(data.get('posterUrl', ''))}" if data.get('posterUrl') else '',
            'year': data.get('year', ''),
            'genre': ", ".join([g.get('genre', '') for g in data.get('genres', [])]),
            'rating': data.get('ratingKinopoisk') or data.get('ratingImdb') or '',
            'countries': ", ".join([c.get('country', '') for c in data.get('countries', [])]),
            'length': f"{data.get('filmLength')} мин." if data.get('filmLength') else '',
            'directors': ", ".join(filter(None, directors)),
            'actors': ", ".join(filter(None, actors)),
            'imdbId': data.get('imdbId', ''),
            'videoSources': sources,
            'url': url_str
        })

    # ─── Video Sources (Balancers) ───────────────────────────
    def api_video_sources(self, query):
        kp_id = query.get('kpId', [''])[0]
        title = query.get('title', [''])[0]
        year = query.get('year', [''])[0]

        if not kp_id and not title:
            self.send_json({'sources': []})
            return

        sources = []

        # Alloha — by kpId (best quality, most reliable)
        if kp_id:
            sources.append({
                'source': 'alloha',
                'name': 'Alloha',
                'type': 'iframe',
                'url': f"https://alloha.tv/player/index.php?kp={kp_id}",
                'quality': 'HD',
                'lang': 'ru'
            })

        # Bazon — by kpId
        if kp_id:
            sources.append({
                'source': 'bazon',
                'name': 'Bazon',
                'type': 'iframe',
                'url': f"https://bazon.cc/video/embed/kp/{kp_id}",
                'quality': 'HD',
                'lang': 'ru'
            })

        # Kinohub — by kpId
        if kp_id:
            sources.append({
                'source': 'kinohub',
                'name': 'KinoHub',
                'type': 'iframe',
                'url': f"https://on.kinohub.vip/embed/kp/{kp_id}",
                'quality': 'HD',
                'lang': 'ru',
                'clipped': True
            })

        # VideoCDN — by title
        if title:
            q = urllib.parse.quote(f"{title} {year}".strip())
            sources.append({
                'source': 'videocdn',
                'name': 'VideoCDN',
                'type': 'iframe',
                'url': f"https://videocdn.tv/api/embed/movie?title={q}",
                'quality': 'auto',
                'lang': 'ru'
            })

        self.send_json({'sources': sources})

    # ─── JSON Helper ─────────────────────────────────────────
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded server — handles requests concurrently (no more hanging!)."""
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print(f"🌐 CineGram Server (Threaded Python) → http://localhost:{PORT}")
    with ThreadedServer(("", PORT), CineGramHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Server stopped.")
