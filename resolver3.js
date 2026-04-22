const KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';
async function resolve(query) {
  const url = `https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(url, { headers: { 'X-API-KEY': KP_KEY } });
  const data = await res.json();
  if (data.films && data.films.length > 0) {
    console.log(`${query} -> ${data.films[0].filmId} (${data.films[0].nameRu})`);
  }
}
async function run() {
  await resolve("Миллиарды");
  await resolve("Декстер");
  await resolve("Шершни");
  await resolve("Почему женщины убивают");
  await resolve("Белый лотос");
  await resolve("Острые предметы");
}
run();
