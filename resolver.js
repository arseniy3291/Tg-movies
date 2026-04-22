const KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';
async function resolve(query) {
  const url = `https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(url, { headers: { 'X-API-KEY': KP_KEY } });
  const data = await res.json();
  if (data.films && data.films.length > 0) {
    console.log(`${query} -> ${data.films[0].filmId} (${data.films[0].nameRu})`);
  } else {
    console.log(`${query} -> Not found`);
  }
}
const titles = [
  // Netflix
  "Уэнздей", "Очень странные дела", "Ведьмак", "Черное зеркало", "Игра в кальмара", "Озарк", "Бумажный дом", "Острые козырьки",
  // HBO
  "Игра престолов", "Евфория", "Одни из нас", "Чернобыль", "Настоящий детектив", "Наследники", "Клан Сопрано", "Прослушка",
  // Apple TV
  "Тед Лассо", "Утреннее шоу", "Разделение", "Основание", "Укрытие", "Защищая Джейкоба", "Чёрная птица",
  // Кинопоиск
  "Король и Шут", "Беспринципные", "Пищеблок", "Топи", "Нулевой пациент", "Монастырь", "Конец света",
  // Amazon Prime
  "Пацаны", "Неуязвимый", "Властелин колец: Кольца власти", "Дрянь", "Фоллаут"
];
async function run() {
  for (const t of titles) {
    await resolve(t);
  }
}
run();
