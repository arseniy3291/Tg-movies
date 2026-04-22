# Настройка парсинга видеобалансеров для CineGram

## Обзор

Данный модуль добавляет поддержку парсинга видеобалансеров для автоматического поиска и воспроизведения фильмов через встроенный плеер. Все источники **бесплатные** и не требуют регистрации (кроме Kodik - опционально).

## Установленные компоненты

### 1. Модуль `balancers.js`
Серверный модуль для поиска видеоисточников в популярных видеобалансерах:

**Поддерживаемые бесплатные балансеры:**
- **Alloha** - бесплатный iframe-плеер с фильмами и сериалами
- **VideoCDN** - крупный CDN с видео контентом
- **Kodik** - требует API токен (можно получить бесплатно на kodik.cc)
- **Sibnet** - старый бесплатный видеохостинг
- **Videobomba** - альтернативный источник
- **VideoRot** - дополнительный бесплатный источник
- **HDVB** - балансёр с HD контентом
- **Jut.su** - для аниме (отключен по умолчанию)

**Основные функции:**
- `searchByTitle(title, year)` - поиск по названию фильма
- `searchByKinopoiskId(kpId)` - поиск по ID Кинопоиска
- `extractIframeFromUrl(url)` - извлечение iframe из HTML

### 2. Обновленный `server.js`
Добавлены новые API endpoints:

#### `/api/movie?url=/movie/{id}`
Возвращает информацию о фильме + массив `videoSources` с найденными источниками.

#### `/api/video-sources?title={name}&year={year}&kpId={id}`
Отдельный endpoint для получения источников видео.

### 3. Обновленный `public/core.v11.js`
Клиентская часть интегрирована с плеером:

- Автоматическое получение videoSources при загрузке фильма
- Добавление кнопок балансеров в переключатель источников
- Поддержка переключения между стандартными зеркалами и балансерами

## Использование

### Запуск сервера

```bash
cd /workspace
node server.js
```

Сервер запустится на `http://localhost:3000`

### Настройка Kodik (опционально)

Для работы с Kodik получите API токен на https://kodik.cc и установите переменную окружения:

```bash
export KODIK_TOKEN=ваш_токен
```

Или измените в `balancers.js`:
```javascript
kodik: {
  token: 'ваш_токен',
  enabled: true
}
```

### Включение/выключение балансеров

В файле `balancers.js` можно управлять доступными балансерами:

```javascript
const BALANCERS = {
  alloha: { enabled: true },    // Alloha - включён
  videocdn: { enabled: true },  // VideoCDN - включён
  kodik: { enabled: false },    // Kodik - выключен (нет токена)
  sibnet: { enabled: true },    // Sibnet - включён
  videobomba: { enabled: true },// Videobomba - включён
  videorot: { enabled: true },  // VideoRot - включён
  hdvb: { enabled: true },      // HDVB - включён
  jutsu: { enabled: false }     // Jut.su - только для аниме
};
```

## Как это работает

1. Пользователь открывает страницу фильма
2. Сервер получает данные из Кинопоиска
3. Параллельно выполняется поиск в видеобалансерах по названию фильма
4. Найденные источники добавляются в ответ API
5. Клиент отображает кнопки всех доступных источников в плеере
6. При выборе источника - загружается соответствующий iframe

## Структура ответа videoSources

```json
{
  "videoSources": [
    {
      "source": "alloha",
      "name": "Alloha",
      "type": "iframe",
      "url": "https://alloha.tv/player/index.php?search=...",
      "directUrl": "https://alloha.tv/player/index.php?search=...",
      "quality": "auto",
      "lang": "ru"
    },
    {
      "source": "videocdn",
      "name": "VideoCDN",
      "type": "iframe",
      "url": "https://videocdn.tv/api/embed/movie?title=...",
      "directUrl": "https://videocdn.tv/api/embed/movie?title=...",
      "quality": "auto",
      "lang": "ru"
    },
    {
      "source": "hdvb",
      "name": "HDVB",
      "type": "iframe",
      "url": "https://hdvb.info/embed?search=...",
      "directUrl": "https://hdvb.info/embed?search=...",
      "quality": "HD",
      "lang": "ru"
    }
  ]
}
```

## Примечания

- **Все источники бесплатные** - не требуется оплата или подписка
- Некоторые балансеры могут требовать CORS проксирование
- Kodik требует обязательной авторизации по API токену (можно получить бесплатно)
- Рекомендуется использовать HTTPS для production
- Для обхода блокировок может потребоваться настройка proxy
- Sibnet использует парсинг HTML для поиска видео

## Тестирование

Проверить работу можно открыв любой фильм и нажав кнопку "Смотреть". 
В переключателе источников должны появиться дополнительные опции от видеобалансеров.

### Быстрый тест модуля

```bash
node -e "const b = require('./balancers'); b.searchByTitle('Матрица', 1999).then(r => console.log('Найдено источников:', r.length));"
```

Ожидаемый результат: 5-7 источников (Alloha, VideoCDN, Videobomba, VideoRot, HDVB, и др.)
