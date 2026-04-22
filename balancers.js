// ════════════════════════════════════════════════════════════════
// VIDEO BALANCERS PARSER MODULE
// Парсинг видеобалансеров для поиска источников видео
// Бесплатные источники: Alloha, VideoCDN, Kodik, Sibnet, Videobomba,
//                        VideoRot, HDVB, Jut.su (аниме), Trancfilm
// ════════════════════════════════════════════════════════════════

const axios = require('axios');
const cheerio = require('cheerio');

// Конфигурация видеобалансеров (бесплатные источники)
const BALANCERS = {
  // Alloha - бесплатный балансер с фильмами и сериалами
  alloha: {
    name: 'Alloha',
    baseUrl: 'https://alloha.tv',
    searchUrl: 'https://alloha.tv/api/search',
    enabled: true
  },
  
  // VideoCDN - крупный бесплатный балансер
  videocdn: {
    name: 'VideoCDN',
    baseUrl: 'https://videocdn.tv',
    searchUrl: 'https://videocdn.tv/api/search',
    enabled: true
  },
  
  // Kodik - требуется API токен (можно получить бесплатно на kodik.cc)
  kodik: {
    name: 'Kodik',
    baseUrl: 'https://kodik.cc',
    searchUrl: 'https://kodik.cc/api/search',
    token: process.env.KODIK_TOKEN || '',
    enabled: false // Включите если есть токен
  },
  
  // Sibnet - старый бесплатный видеохостинг
  sibnet: {
    name: 'Sibnet',
    baseUrl: 'https://video.sibnet.ru',
    searchUrl: 'https://video.sibnet.ru/search/',
    enabled: true
  },
  
  // Videobomba - бесплатный балансер
  videobomba: {
    name: 'Videobomba',
    baseUrl: 'https://videobomba.net',
    searchUrl: 'https://videobomba.net/search',
    enabled: true
  },
  
  // VideoRot - ещё один бесплатный источник
  videorot: {
    name: 'VideoRot',
    baseUrl: 'https://videorot.com',
    searchUrl: 'https://videorot.com/search',
    enabled: true
  },
  
  // HDVB - балансёр с HD контентом
  hdvb: {
    name: 'HDVB',
    baseUrl: 'https://hdvb.info',
    searchUrl: 'https://hdvb.info/search',
    enabled: true
  },
  
  // Jut.su - для аниме (если нужно)
  jutsu: {
    name: 'Jut.su',
    baseUrl: 'https://jut.su',
    searchUrl: 'https://jut.su/search',
    enabled: false // Только для аниме
  }
};

/**
 * Поиск видео по названию фильма
 * @param {string} title - Название фильма
 * @param {number} year - Год выпуска (опционально)
 * @returns {Promise<Array>} - Массив найденных источников
 */
async function searchByTitle(title, year = null) {
  const results = [];
  const queries = [];

  // Формируем поисковые запросы для каждого активного балансера
  if (BALANCERS.alloha.enabled) {
    queries.push(searchAlloha(title, year));
  }
  
  if (BALANCERS.videocdn.enabled) {
    queries.push(searchVideoCDN(title, year));
  }
  
  if (BALANCERS.kodik.enabled && BALANCERS.kodik.token) {
    queries.push(searchKodik(title, year));
  }
  
  if (BALANCERS.sibnet.enabled) {
    queries.push(searchSibnet(title, year));
  }
  
  if (BALANCERS.videobomba.enabled) {
    queries.push(searchVideobomba(title, year));
  }
  
  if (BALANCERS.videorot.enabled) {
    queries.push(searchVideoRot(title, year));
  }
  
  if (BALANCERS.hdvb.enabled) {
    queries.push(searchHDVB(title, year));
  }

  try {
    const allResults = await Promise.allSettled(queries);
    
    allResults.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        results.push(...result.value);
      } else if (result.status === 'rejected') {
        console.error('[Balancers] Search error:', result.reason?.message);
      }
    });
  } catch (error) {
    console.error('[Balancers] Critical error:', error.message);
  }

  return results;
}

/**
 * Поиск в Alloha - генерирует iframe URL для поиска
 */
async function searchAlloha(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const iframeUrl = `${BALANCERS.alloha.baseUrl}/player/index.php?search=${query}`;
    
    return [{
      source: 'alloha',
      name: BALANCERS.alloha.name,
      type: 'iframe',
      url: iframeUrl,
      directUrl: iframeUrl,
      quality: 'auto',
      lang: 'ru'
    }];
  } catch (error) {
    console.error('[Alloha] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в VideoCDN - генерирует iframe URL
 */
async function searchVideoCDN(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const iframeUrl = `${BALANCERS.videocdn.baseUrl}/api/embed/movie?title=${query}`;
    
    return [{
      source: 'videocdn',
      name: BALANCERS.videocdn.name,
      type: 'iframe',
      url: iframeUrl,
      directUrl: iframeUrl,
      quality: 'auto',
      lang: 'ru'
    }];
  } catch (error) {
    console.error('[VideoCDN] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в Kodik (требуется API токен)
 */
async function searchKodik(title, year) {
  try {
    const response = await axios.get(BALANCERS.kodik.searchUrl, {
      params: {
        token: BALANCERS.kodik.token,
        title: title,
        year: year,
        limit: 5
      },
      timeout: 5000
    });

    if (response.data && response.data.results) {
      return response.data.results.map(item => ({
        source: 'kodik',
        name: BALANCERS.kodik.name,
        type: 'iframe',
        url: `https://kodik.cc/video/${item.shikimori_id || item.id}`,
        directUrl: item.link || `https://kodik.cc/video/${item.shikimori_id || item.id}`,
        quality: item.quality || 'auto',
        lang: item.translate || 'ru'
      }));
    }
    
    return [];
  } catch (error) {
    console.error('[Kodik] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в Sibnet - поиск по сайту и извлечение iframe
 */
async function searchSibnet(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const searchUrl = `${BALANCERS.sibnet.searchUrl}${query}`;
    
    // Sibnet требует парсинга HTML для получения video URL
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    const videoLinks = [];
    
    // Ищем ссылки на видео страницы
    $('a[href^="/video/"]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      if (href && text.includes(title.toLowerCase().split(' ')[0])) {
        videoLinks.push(`${BALANCERS.sibnet.baseUrl}${href}`);
      }
    });
    
    if (videoLinks.length > 0) {
      // Возвращаем первую найденную ссылку как iframe
      return [{
        source: 'sibnet',
        name: BALANCERS.sibnet.name,
        type: 'iframe',
        url: videoLinks[0],
        directUrl: videoLinks[0],
        quality: 'auto',
        lang: 'ru'
      }];
    }
    
    return [];
  } catch (error) {
    console.error('[Sibnet] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в Videobomba
 */
async function searchVideobomba(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const iframeUrl = `${BALANCERS.videobomba.baseUrl}/embed?search=${query}`;
    
    return [{
      source: 'videobomba',
      name: BALANCERS.videobomba.name,
      type: 'iframe',
      url: iframeUrl,
      directUrl: iframeUrl,
      quality: 'auto',
      lang: 'ru'
    }];
  } catch (error) {
    console.error('[Videobomba] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в VideoRot
 */
async function searchVideoRot(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const iframeUrl = `${BALANCERS.videorot.baseUrl}/embed?search=${query}`;
    
    return [{
      source: 'videorot',
      name: BALANCERS.videorot.name,
      type: 'iframe',
      url: iframeUrl,
      directUrl: iframeUrl,
      quality: 'auto',
      lang: 'ru'
    }];
  } catch (error) {
    console.error('[VideoRot] Error:', error.message);
    return [];
  }
}

/**
 * Поиск в HDVB
 */
async function searchHDVB(title, year) {
  try {
    const query = encodeURIComponent(`${title} ${year || ''}`.trim());
    const iframeUrl = `${BALANCERS.hdvb.baseUrl}/embed?search=${query}`;
    
    return [{
      source: 'hdvb',
      name: BALANCERS.hdvb.name,
      type: 'iframe',
      url: iframeUrl,
      directUrl: iframeUrl,
      quality: 'HD',
      lang: 'ru'
    }];
  } catch (error) {
    console.error('[HDVB] Error:', error.message);
    return [];
  }
}

/**
 * Поиск по Kinopoisk ID через сторонние сервисы
 */
async function searchByKinopoiskId(kpId) {
  const results = [];
  
  // Пытаемся найти через Shikimori (если есть связь)
  try {
    // Запрос к API для получения Shikimori ID по Kinopoisk ID
    const shikiResponse = await axios.get(
      `https://shikimori.one/api/animes?kinopoisk_id=${kpId}`,
      { timeout: 5000 }
    ).catch(() => null);

    if (shikiResponse?.data?.length > 0) {
      const shikiId = shikiResponse.data[0].id;
      
      // Ищем в Kodik по Shikimori ID
      if (BALANCERS.kodik.enabled && BALANCERS.kodik.token) {
        const kodikResults = await searchKodikByShikimoriId(shikiId);
        results.push(...kodikResults);
      }
    }
  } catch (error) {
    console.error('[KP ID Search] Error:', error.message);
  }

  return results;
}

/**
 * Поиск в Kodik по Shikimori ID
 */
async function searchKodikByShikimoriId(shikiId) {
  try {
    const response = await axios.get('https://kodik.cc/api/search', {
      params: {
        token: BALANCERS.kodik.token,
        shikimori_id: shikiId,
        limit: 5
      },
      timeout: 5000
    });

    if (response.data && response.data.results) {
      return response.data.results.map(item => ({
        source: 'kodik',
        name: BALANCERS.kodik.name,
        type: 'iframe',
        url: `https://kodik.cc/video/${item.shikimori_id}`,
        directUrl: item.link || `https://kodik.cc/video/${item.shikimori_id}`,
        quality: item.quality || 'auto',
        lang: item.translate || 'ru'
      }));
    }
    
    return [];
  } catch (error) {
    console.error('[Kodik Shiki] Error:', error.message);
    return [];
  }
}

/**
 * Парсинг HTML страницы для извлечения iframe (для сложных случаев)
 */
async function extractIframeFromUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const iframe = $('iframe').first();
    
    if (iframe.length) {
      return iframe.attr('src');
    }

    // Попытка найти в скриптах
    const scripts = $('script');
    for (let i = 0; i < scripts.length; i++) {
      const content = $(scripts[i]).html() || '';
      const match = content.match(/['"]([^'"]*\/\/[^'"]*\/embed[^'"]*)['"]/);
      if (match) {
        return match[1];
      }
    }

    return null;
  } catch (error) {
    console.error('[Extract Iframe] Error:', error.message);
    return null;
  }
}

module.exports = {
  searchByTitle,
  searchByKinopoiskId,
  extractIframeFromUrl,
  BALANCERS
};
