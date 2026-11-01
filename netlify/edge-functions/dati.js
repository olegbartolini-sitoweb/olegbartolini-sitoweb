/* Copia veloce dei fogli Google.
   Il sito chiede /dati/<gid>.csv invece di andare ogni volta su Google:
   Netlify tiene una copia pronta vicino a chi visita e la rinfresca da Google
   al massimo ogni minuto, così le pagine si caricano subito. */

const BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsbM6PfC3ogxct0drD5LScDCwalsIzkJSF5WmSYBk5A9q34H3upzsd4L56U-12c1CRHMAVyrGDsIVb/pub";
const FOGLI = ["363155436", "487241243", "158224771", "1142098266"]; /* notizie, atti, impostazioni, valori */

export default async (request) => {
  const gid = new URL(request.url).pathname.replace(/^\/dati\//, "").replace(/\.csv$/, "");
  if (!FOGLI.includes(gid)) return new Response("Non trovato", { status: 404 });
  const r = await fetch(`${BASE}?gid=${gid}&single=true&output=csv`, { redirect: "follow" });
  if (!r.ok) return new Response("Foglio non raggiungibile", { status: 502, headers: { "cache-control": "no-store" } });
  return new Response(await r.text(), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, s-maxage=60, stale-while-revalidate=604800"
    }
  });
};

export const config = { path: "/dati/*", cache: "manual" };
