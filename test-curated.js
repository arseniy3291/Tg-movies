const KP_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';
async function kpFetch(path) {
  const url = `https://kinopoiskapiunofficial.tech${path}`;
  const res = await fetch(url, { headers: { 'X-API-KEY': KP_KEY } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`Error parsing JSON for ${url}: status=${res.status}, body=${text}`);
    throw e;
  }
}
const CURATED = [4182931, 1044455, 1316601, 5556105, 1007823, 1005878, 1227189, 1318991, 1146313];
Promise.all(CURATED.map(id => kpFetch(`/api/v2.2/films/${id}`)))
  .then(() => console.log('All good!'))
  .catch(e => console.error(e.message));
