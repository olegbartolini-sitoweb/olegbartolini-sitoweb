/* Foto caricate dal pannello.
   POST /api/foto  → salva la foto (grande + piccola, già ridimensionate dal telefono)
   GET  /foto/...  → la mostra ai visitatori */
import { archivio, json, errore, chiSei, dalPannello, nuovoId } from "./_comune/comune.mjs";

const TIPI = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX = 5 * 1024 * 1024;

export default async (req) => {
  const url = new URL(req.url);
  const store = archivio("foto");

  if (req.method === "GET" && url.pathname.startsWith("/foto/")) {
    const chiave = url.pathname.slice(6);
    if (!/^[\w-]+\.(jpg|png|webp)$/.test(chiave)) return new Response("Non trovata", { status: 404 });
    const f = await store.getWithMetadata(chiave, { type: "arrayBuffer" });
    if (!f) return new Response("Non trovata", { status: 404 });
    return new Response(f.data, { headers: {
      "content-type": (f.metadata && f.metadata.tipo) || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, durable, max-age=31536000, immutable"
    } });
  }

  if (req.method === "POST" && url.pathname === "/api/foto") {
    if (!dalPannello(req)) return errore("Richiesta non valida", 403);
    if (!(await chiSei(req))) return errore("Accesso scaduto: entra di nuovo", 401);
    let modulo; try { modulo = await req.formData(); } catch { return errore("Foto non leggibile"); }
    const grande = modulo.get("grande"), piccola = modulo.get("piccola");
    if (!grande || typeof grande === "string") return errore("Manca la foto");
    const est = TIPI[grande.type];
    if (!est) return errore("Formato non supportato: usa JPG, PNG o WebP");
    if (grande.size > MAX) return errore("Foto troppo grande");
    const base = new Date().toISOString().slice(0, 10) + "-" + nuovoId();
    await store.set(`${base}.${est}`, await grande.arrayBuffer(), { metadata: { tipo: grande.type } });
    if (piccola && typeof piccola !== "string" && TIPI[piccola.type] === est && piccola.size <= MAX)
      await store.set(`${base}-p.${est}`, await piccola.arrayBuffer(), { metadata: { tipo: piccola.type } });
    return json({ url: `/foto/${base}.${est}` });
  }

  return new Response("Non trovata", { status: 404 });
};

export const config = { path: ["/foto/*", "/api/foto"] };
