/* Contenuti del sito per i visitatori (notizie, atti, testi, valori).
   Netlify ne tiene una copia per pochi secondi: le modifiche dal pannello compaiono quasi subito. */
import { leggiDati, json, attiDalFoglio, uniscitAtti } from "./_comune/comune.mjs";

export default async () => {
  const [d, f] = await Promise.all([leggiDati(), attiDalFoglio()]);
  const fuori = {
    migrato: !!d.migrato, aggiornato: d.aggiornato,
    notizie: d.notizie.map(({ autore, creato, modificato, ...n }) => n),
    atti: uniscitAtti(d.atti, f.lista), impostazioni: d.impostazioni, valori: d.valori
  };
  return json(fuori, 200, {
    "cache-control": "public, max-age=0, must-revalidate",
    "netlify-cdn-cache-control": "public, durable, s-maxage=10, stale-while-revalidate=120"
  });
};

export const config = { path: "/api/pubblico" };
