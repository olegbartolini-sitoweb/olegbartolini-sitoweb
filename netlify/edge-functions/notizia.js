/* Anteprima delle notizie condivise (WhatsApp, Facebook, Telegram, X).
   Quando qualcuno apre olegbartolini.it/notizia/<id>, questa funzione legge
   il Foglio Google, trova la notizia e mette nella pagina titolo, riassunto e
   foto della notizia, così l'anteprima mostra proprio quella notizia.
   Il sito poi apre la notizia da solo. */

const FOGLIO_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsbM6PfC3ogxct0drD5LScDCwalsIzkJSF5WmSYBk5A9q34H3upzsd4L56U-12c1CRHMAVyrGDsIVb/pub?gid=363155436&single=true&output=csv";
const SITO = "https://olegbartolini.it";

function leggiCSV(t) {
  const righe = []; let r = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { r.push(c); c = ""; }
    else if (ch === "\n") { r.push(c); righe.push(r); r = []; c = ""; }
    else if (ch !== "\r") c += ch;
  }
  if (c || r.length) { r.push(c); righe.push(r); }
  return righe;
}
function dataISO(s) {
  s = (s || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
}
const sicuro = u => /^https:\/\//i.test(u || "") ? u : "";
function fotoURL(u) {
  u = (u || "").trim();
  const d = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (d) return "https://lh3.googleusercontent.com/d/" + d[1];
  if (/^foto-notizie\/[\w.-]+$/.test(u)) return SITO + "/" + u;
  return sicuro(u);
}
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const piano = t => String(t ?? "").replace(/\*\*(?=\S)([\s\S]+?)\*\*/g, "$1").replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?![*\w])/g, "$1$2").replace(/(^|[^\w/])_(?=\S)([^_\n]+?)_(?![\w])/g, "$1$2");
const attr = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function notizieDalFoglio(testo) {
  const [int, ...righe] = leggiCSV(testo);
  const nh = int.map(h => h.trim().toLowerCase().replace(/\s+/g, " "));
  const col = nome => nh.findIndex(h => h.startsWith(nome));
  const k = { data: col("data"), titolo: col("titolo"), sommario: col("sommario"), testo: nh.indexOf("testo") >= 0 ? nh.indexOf("testo") : col("testo"), foto: col("foto") };
  const usati = new Set();
  return righe.map(r => {
    const g = i => i >= 0 ? (r[i] || "").trim() : "";
    const n = { data: dataISO(g(k.data)), titolo: g(k.titolo), sommario: g(k.sommario), testo: g(k.testo), foto: fotoURL(g(k.foto)) };
    if (!n.data || !n.titolo) return null;
    let id = slug(n.data + "-" + n.titolo) || "n"; while (usati.has(id)) id += "-2"; usati.add(id); n.id = id;
    return n;
  }).filter(Boolean);
}

export default async (request, context) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.replace(/^\/notizia\//, "").replace(/\/$/, ""));
  let pagina = await context.next();
  if (pagina.status === 404) pagina = await fetch(new URL("/", url));
  let html = await pagina.text();
  try {
    const csv = await fetch(FOGLIO_CSV, { headers: { "User-Agent": "olegbartolini.it" } }).then(r => r.ok ? r.text() : "");
    const n = csv ? notizieDalFoglio(csv).find(x => x.id === id) : null;
    if (n) {
      const titolo = piano(n.titolo);
      let descr = piano(n.sommario || n.testo).replace(/\s+/g, " ").trim();
      if (descr.length > 200) descr = descr.slice(0, 197).replace(/\s+\S*$/, "") + "…";
      const link = SITO + "/notizia/" + n.id;
      const sost = (re, nuovo) => { html = re.test(html) ? html.replace(re, nuovo) : html.replace("</head>", nuovo + "\n</head>"); };
      sost(/<title>[^<]*<\/title>/, `<title>${attr(titolo)} · Oleg Bartolini</title>`);
      sost(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(descr)}">`);
      sost(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${attr(titolo)}">`);
      sost(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${attr(descr)}">`);
      sost(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${attr(link)}">`);
      sost(/<meta property="og:type"[^>]*>/, `<meta property="og:type" content="article">`);
      if (n.foto) sost(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${attr(n.foto)}">`);
      sost(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${attr(link)}">`);
      sost(/<meta name="twitter:card"[^>]*>/, `<meta name="twitter:card" content="summary_large_image">`);
    }
  } catch (e) { /* se il foglio non risponde, resta l'anteprima generale del sito */ }
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": "public, max-age=300" } });
};

export const config = { path: "/notizia/*" };
