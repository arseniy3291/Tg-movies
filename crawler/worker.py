"""Crawl4AI HTTP fetching and CSS extraction, JSON-lines protocol over stdio.

The current source renders its catalog and embed URLs in HTML, so it does not
need Chromium. Login pages and challenges are reported, never treated as data.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("CRAWL4_AI_BASE_DIRECTORY", str(ROOT / ".crawl4ai"))
OUTPUT = sys.stdout
sys.stdout = sys.stderr  # Keep dependency diagnostics out of the JSON protocol.

from crawl4ai import CrawlerRunConfig, JsonCssExtractionStrategy
from crawl4ai.async_configs import HTTPCrawlerConfig
from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy


def field(name, selector=None, attribute=None):
    result = {"name": name, "type": "attribute" if attribute else "text"}
    if selector:
        result["selector"] = selector
    if attribute:
        result["attribute"] = attribute
    return result


CATALOG = {
    "name": "HDRezka catalog", "baseSelector": "#dle-content .postItem",
    "fields": [field("title", ".postTitle a"), field("href", ".postTitle a", "href"),
               field("poster", "img.poster", "data-src"), field("posterFallback", "img.poster", "src"),
               field("info", ".misc")],
}
MOVIE = {
    "name": "HDRezka movie", "baseSelector": "#dle-content .innerPost",
    "fields": [
        field("title", "h1"), field("originalTitle", ".altName"),
        field("poster", ".postImg img", "src"), field("description", ".postText"),
        field("descriptionHeading", ".postText h2"), field("actors", ".infoData:has(.cast)"),
        {"name": "actorNames", "selector": ".infoData:has(.cast) .personLink", "type": "nested_list", "fields": [field("name")]},
        field("ratingKp", ".b-post__info_rates.kp .bold"), field("ratingImdb", ".b-post__info_rates.imdb .bold"),
        {"name": "info", "selector": ".post__info tr", "type": "nested_list",
         "fields": [field("key", "td:first-child"), field("value", "td:nth-child(2)"),
                    {"name": "links", "selector": "td:nth-child(2) a", "type": "nested_list", "fields": [field("name")]}]},
        {"name": "players", "selector": ".playerWrap .player-tabs [data-src], .playerWrap .player-container iframe",
         "type": "nested_list", "fields": [field("name"), field("url", attribute="data-src"), field("src", attribute="src")]},
    ],
}
KINOGO_SEARCH = {
    "name": "Kinogo search", "baseSelector": "#dle-content .movie",
    "fields": [
        field("title", ".shortstorytitle h2 a"),
        field("href", ".shortstorytitle h2 a", "href"),
        {"name": "info", "selector": ".movie__info-item", "type": "nested_list",
         "fields": [field("key", "b"), field("value")]},
    ],
}
KINOGO_MOVIE = {
    "name": "Kinogo movie", "baseSelector": "#dle-content",
    "fields": [
        field("title", ".movie h1"),
        field("ldJson", 'script[type="application/ld+json"]'),
        {"name": "tabs", "selector": ".player-tabs li", "type": "nested_list", "fields": [field("name")]},
        {"name": "players", "selector": "#preroll .box iframe", "type": "nested_list",
         "fields": [field("url", attribute="data-src"), field("src", attribute="src")]},
    ],
}
STRATEGIES = {
    "catalog": JsonCssExtractionStrategy(CATALOG),
    "movie": JsonCssExtractionStrategy(MOVIE),
    "kinogo_search": JsonCssExtractionStrategy(KINOGO_SEARCH),
    "kinogo_movie": JsonCssExtractionStrategy(KINOGO_MOVIE),
}
ALLOWED_HOSTS = {"lv.hdrezka.inc", "rezka.fi", "rezka.si", "go3.kinogo.cc", "kinogo.la"}


def extract(kind, body, url):
    if 'id="dle-content"' not in body and "id='dle-content'" not in body:
        raise ValueError("Источник вернул страницу входа или проверки доступа")
    return STRATEGIES[kind].extract(url, body)


def emit(data):
    OUTPUT.write(json.dumps(data, ensure_ascii=False) + "\n")
    OUTPUT.flush()


async def main():
    config = HTTPCrawlerConfig(follow_redirects=True, verify_ssl=True,
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ru,en;q=0.8"},
        downloads_path=str(ROOT / ".crawl4ai" / "downloads"))
    limit = asyncio.Semaphore(2)
    tasks = set()
    async with AsyncHTTPCrawlerStrategy(browser_config=config) as crawler:
        async def handle(job):
            try:
                parsed = urlsplit(job["url"])
                if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.port not in (None, 443) or parsed.username or parsed.password:
                    raise ValueError("Недопустимый адрес источника")
                if job["kind"] not in STRATEGIES:
                    raise ValueError("Неизвестный тип страницы")
                async with limit:
                    response = await asyncio.wait_for(crawler.crawl(job["url"], config=CrawlerRunConfig(page_timeout=15000)), timeout=20)
                    if not 200 <= response.status_code < 300:
                        raise ValueError("Источник недоступен")
                    if len(response.html) > 3 * 1024 * 1024:
                        raise ValueError("Страница источника слишком большая")
                    data = extract(job["kind"], response.html, job["url"])
                emit({"id": job["id"], "data": data})
            except Exception as error:
                status = getattr(error, "status_code", None)
                message = str(error) if isinstance(error, ValueError) else "Источник сейчас недоступен или ограничивает доступ"
                emit({"id": job.get("id"), "error": message, "status": 404 if status == 404 else 502})

        while line := await asyncio.to_thread(sys.stdin.readline):
            try:
                job = json.loads(line)
                if len(tasks) >= 8:
                    emit({"id": job.get("id"), "error": "Парсер занят. Попробуйте снова.", "status": 503})
                    continue
                task = asyncio.create_task(handle(job))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
            except (ValueError, TypeError):
                emit({"id": None, "error": "Некорректный запрос", "status": 400})
        if tasks:
            await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
