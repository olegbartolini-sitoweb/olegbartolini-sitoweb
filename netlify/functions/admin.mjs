/* Pannello di gestione: tutte le richieste di /api/admin/...
   Accesso con utente e password; ogni modifica resta nel registro con il nome di chi l'ha fatta. */

import {
  json, errore, leggiDati, scriviDati, VUOTO, leggiUtenti, salvaUtenti, pubblico, passwordGiusta, nuovaImpronta,
  passwordCasuale, cookieSessione, cookieUscita, chiSei, dalPannello, testo, dataISO, link, fotoOk, slug, nuovoId, leggiCSV,
  norm, pulisciAtto, attiDalFoglio, chiaveAtto
} from "./_comune/comune.mjs";

const FOGLIO = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsbM6PfC3ogxct0drD5LScDCwalsIzkJSF5WmSYBk5A9q34H3upzsd4L56U-12c1CRHMAVyrGDsIVb/pub";
const GID = { notizie: "363155436", atti: "487241243", altri: ["158224771", "1142098266"] };

const aspetta = ms => new Promise(r => setTimeout(r, ms));

/* ---------- pulizia di una notizia / un atto ---------- */
function pulisciNotizia(n) {
  return {
    data: dataISO(n.data), tema: testo(n.tema, 60) || "Notizie", titolo: testo(n.titolo, 300),
    sommario: testo(n.sommario, 1000), testo: testo(n.testo, 60000), foto: fotoOk(n.foto),
    galleria: (Array.isArray(n.galleria) ? n.galleria : []).map(fotoOk).filter(Boolean).slice(0, 30),
    link: (Array.isArray(n.link) ? n.link : []).map(l => ({ url: link(l && l.url), txt: testo(l && l.txt, 60) })).filter(l => l.url).slice(0, 3)
  };
}
function idNotizia(n, esistenti) {
  let id = slug(n.data + "-" + n.titolo) || "n";
  while (esistenti.has(id)) id += "-2";
  return id;
}

/* ---------- importazione dai fogli Google ---------- */
async function scaricaFoglio(gid) {
  const r = await fetch(`${FOGLIO}?gid=${gid}&single=true&output=csv&t=${Date.now()}`, { redirect: "follow" });
  if (!r.ok) throw new Error("Foglio " + gid + " non raggiungibile (" + r.status + ")");
  return leggiCSV(await r.text());
}
function notizieDaFoglio(righe) {
  const [int, ...rr] = righe;
  const nh = int.map(norm), col = n => nh.findIndex(h => h.startsWith(n));
  const k = { data: col("data"), tema: col("argomento"), titolo: col("titolo"), sommario: col("sommario"), testo: nh.indexOf("testo") >= 0 ? nh.indexOf("testo") : col("testo"), foto: nh.indexOf("foto") >= 0 ? nh.indexOf("foto") : col("foto"), altre: nh.findIndex(h => /^(altre foto|foto aggiuntive|galleria)/.test(h)) };
  const kl = [1, 2, 3].map(i => ({ url: nh.findIndex(h => h === "link " + i), txt: nh.findIndex(h => new RegExp("^(testo|scritta) (del )?(bottone|pulsante|link) " + i + "$").test(h)) }));
  if (kl[0].url < 0) kl[0].url = nh.findIndex(h => /^link( facebook)?$/.test(h));
  const usati = new Set();
  return rr.map(r => {
    const g = i => i >= 0 ? (r[i] || "").trim() : "";
    const n = pulisciNotizia({ data: g(k.data), tema: g(k.tema), titolo: g(k.titolo), sommario: g(k.sommario), testo: g(k.testo), foto: g(k.foto),
      galleria: g(k.altre).split(/[\s,;]+/), link: kl.map(c => ({ url: g(c.url), txt: g(c.txt) })) });
    if (!n.data || !n.titolo) return null;
    n.id = idNotizia(n, usati); usati.add(n.id); /* stesso indirizzo di prima: i link già condivisi continuano a funzionare */
    return n;
  }).filter(Boolean);
}
function altriDaFoglio(righe, d) {
  const h = norm((righe[0] || [])[0]);
  if (h.startsWith("voce")) {
    righe.slice(1).forEach(r => { if (r[0] && r[0].trim()) d.impostazioni[norm(r[0])] = testo(r[1], 20000); });
  } else if (h.startsWith("valore")) {
    const int = righe[0], col = n => int.findIndex(x => norm(x).startsWith(n));
    const k = { t: col("valore"), d: col("descr"), p: col("propost") };
    d.valori = righe.slice(1).map(r => ({ valore: testo(r[k.t], 120), descrizione: k.d >= 0 ? testo(r[k.d], 20000) : "", proposte: k.p >= 0 ? testo(r[k.p], 5000) : "" })).filter(v => v.valore);
  }
}

/* ---------- smistamento delle richieste ---------- */
export default async (req) => {
  const via = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const metodo = req.method;
  if (metodo !== "GET" && !dalPannello(req)) return errore("Richiesta non valida", 403);
  let corpo = {};
  if (metodo === "POST") { try { corpo = await req.json(); } catch { corpo = {}; } }

  /* --- entrata e uscita --- */
  if (via === "entra" && metodo === "POST") {
    const utenti = await leggiUtenti();
    const u = utenti.find(x => x.utente === norm(corpo.utente));
    if (!u || !(await passwordGiusta(u, String(corpo.password || "")))) { await aspetta(900); return errore("Utente o password sbagliati", 401); }
    return json({ utente: pubblico(u) }, 200, { "set-cookie": await cookieSessione(u) });
  }
  if (via === "esci") return json({ ok: true }, 200, { "set-cookie": cookieUscita() });

  const io = await chiSei(req);
  if (!io) return errore("Accesso scaduto: entra di nuovo", 401);
  const admin = io.ruolo === "admin";

  if (via === "io") return json({ utente: pubblico(io) });

  /* --- lettura di tutto --- */
  if (via === "dati" && metodo === "GET") {
    const d = await leggiDati(), f = await attiDalFoglio();
    const nelFoglio = new Set(f.lista.map(chiaveAtto));
    d.atti = d.atti.map(a => ({ ...a, doppione: nelFoglio.has(chiaveAtto(a)) }));
    return json({ ...d, attiFoglio: f.lista, foglioRaggiungibile: f.ok });
  }

  if (via === "utenti/elenco") return admin ? json({ utenti: (await leggiUtenti()).map(pubblico) }) : errore("Solo l'amministratore può farlo", 403);

  if (metodo !== "POST") return errore("Non trovato", 404);

  /* --- notizie --- */
  if (via === "notizia") {
    const d = await leggiDati();
    const n = pulisciNotizia(corpo.notizia || {});
    if (!n.data) return errore("Manca la data");
    if (!n.titolo) return errore("Manca il titolo");
    const nid = (corpo.notizia || {}).id;
    const i = nid ? d.notizie.findIndex(x => x.id === nid) : -1;
    if (i >= 0) { n.id = d.notizie[i].id; n.creato = d.notizie[i].creato; d.notizie[i] = { ...n, modificato: new Date().toISOString(), autore: io.nome }; }
    else { n.id = idNotizia(n, new Set(d.notizie.map(x => x.id))); d.notizie.push({ ...n, creato: new Date().toISOString(), autore: io.nome }); }
    await scriviDati(d, io, (i >= 0 ? "Ha modificato la notizia «" : "Ha pubblicato la notizia «") + n.titolo + "»");
    return json({ notizia: d.notizie.find(x => x.id === n.id) });
  }
  if (via === "notizia/elimina") {
    const d = await leggiDati(); const n = d.notizie.find(x => x.id === corpo.id);
    if (!n) return errore("Notizia non trovata", 404);
    d.notizie = d.notizie.filter(x => x.id !== corpo.id);
    await scriviDati(d, io, "Ha eliminato la notizia «" + n.titolo + "»");
    return json({ ok: true });
  }

  /* --- atti --- */
  if (via === "atto") {
    const d = await leggiDati();
    const a = pulisciAtto(corpo.atto || {});
    if (!a.data) return errore("Manca la data");
    if (!a.titolo) return errore("Manca il titolo");
    const aid = (corpo.atto || {}).id;
    const i = aid ? d.atti.findIndex(x => x.id === aid) : -1;
    if (i >= 0) { a.id = d.atti[i].id; d.atti[i] = a; } else { a.id = nuovoId("a"); d.atti.push(a); }
    await scriviDati(d, io, (i >= 0 ? "Ha modificato l'atto «" : "Ha aggiunto l'atto «") + a.titolo + "»");
    return json({ atto: a });
  }
  if (via === "atti/togli-doppioni") {
    const d = await leggiDati(), f = await attiDalFoglio();
    if (!f.ok) return errore("Il Foglio Google non risponde: riprova tra poco", 502);
    const nelFoglio = new Set(f.lista.map(chiaveAtto)), prima = d.atti.length;
    d.atti = d.atti.filter(a => !nelFoglio.has(chiaveAtto(a)));
    const tolti = prima - d.atti.length;
    if (tolti) await scriviDati(d, io, `Ha tolto ${tolti} atti doppi (già presenti nel Foglio)`);
    return json({ tolti });
  }
  if (via === "atto/elimina") {
    const d = await leggiDati(); const a = d.atti.find(x => x.id === corpo.id);
    if (!a) return errore("Atto non trovato", 404);
    d.atti = d.atti.filter(x => x.id !== corpo.id);
    await scriviDati(d, io, "Ha eliminato l'atto «" + a.titolo + "»");
    return json({ ok: true });
  }

  /* --- testi del sito e valori --- */
  if (via === "impostazioni") {
    const d = await leggiDati(), v = corpo.impostazioni || {};
    const chiavi = ["ruolo", "etichetta", "presentazione", "chi sono", "riquadro 1", "riquadro 2", "riquadro 3", "riquadro 4", "atti ispettivi"];
    chiavi.forEach(k => { if (k in v) d.impostazioni[k] = testo(v[k], 20000); });
    await scriviDati(d, io, "Ha modificato i testi del sito");
    return json({ impostazioni: d.impostazioni });
  }
  if (via === "valori") {
    const d = await leggiDati();
    d.valori = (Array.isArray(corpo.valori) ? corpo.valori : []).map(v => ({ valore: testo(v.valore, 120), descrizione: testo(v.descrizione, 20000), proposte: testo(v.proposte, 5000) })).filter(v => v.valore).slice(0, 40);
    await scriviDati(d, io, "Ha modificato i valori");
    return json({ valori: d.valori });
  }

  /* --- la propria password --- */
  if (via === "password") {
    const nuova = String(corpo.nuova || "");
    if (nuova.length < 10) return errore("La nuova password deve avere almeno 10 caratteri");
    if (!(await passwordGiusta(io, String(corpo.vecchia || "")))) { await aspetta(900); return errore("La password attuale non è giusta", 401); }
    const utenti = await leggiUtenti(), u = utenti.find(x => x.id === io.id);
    Object.assign(u, await nuovaImpronta(nuova), { versione: (u.versione || 1) + 1 });
    await salvaUtenti(utenti);
    return json({ ok: true }, 200, { "set-cookie": await cookieSessione(u) });
  }

  /* ---------- da qui in poi solo l'amministratore ---------- */
  if (!admin) return errore("Solo l'amministratore può farlo", 403);

  if (via === "utenti/nuovo") {
    const utenti = await leggiUtenti();
    const nome = testo(corpo.nome, 80), utente = slug(corpo.utente || corpo.nome).replace(/-/g, ".").slice(0, 40);
    if (!nome || !utente) return errore("Scrivi nome e nome utente");
    if (utenti.some(x => x.utente === utente)) return errore("Questo nome utente esiste già");
    const password = passwordCasuale();
    utenti.push({ id: nuovoId("u"), utente, nome, ruolo: corpo.ruolo === "admin" ? "admin" : "collaboratore", versione: 1, ...(await nuovaImpronta(password)) });
    await salvaUtenti(utenti);
    return json({ utente, password });
  }
  if (via === "utenti/nuova-password") {
    const utenti = await leggiUtenti(), u = utenti.find(x => x.id === corpo.id);
    if (!u) return errore("Utente non trovato", 404);
    const password = passwordCasuale();
    Object.assign(u, await nuovaImpronta(password), { versione: (u.versione || 1) + 1 });
    await salvaUtenti(utenti);
    return json({ utente: u.utente, password });
  }
  if (via === "utenti/elimina") {
    if (corpo.id === io.id) return errore("Non puoi eliminare te stesso");
    const utenti = await leggiUtenti();
    if (!utenti.some(x => x.id === corpo.id)) return errore("Utente non trovato", 404);
    await salvaUtenti(utenti.filter(x => x.id !== corpo.id));
    return json({ ok: true });
  }

  /* --- importazione dal Foglio Google --- */
  if (via === "importa") {
    const attuali = await leggiDati();
    if (attuali.migrato && !corpo.sovrascrivi) return errore("I contenuti sono già stati importati. Per rifarlo conferma la sovrascrittura.", 409);
    const d = VUOTO();
    d.registro = attuali.registro || [];
    try {
      d.notizie = notizieDaFoglio(await scaricaFoglio(GID.notizie)).map(n => ({ ...n, creato: new Date().toISOString(), autore: "Foglio Google" }));
      d.atti = []; /* gli atti restano nel Foglio: il sito li legge da lì, niente doppioni */
      for (const g of GID.altri) altriDaFoglio(await scaricaFoglio(g), d);
    } catch (e) { return errore("Importazione non riuscita: " + e.message, 502); }
    await scriviDati(d, io, `Ha importato dal Foglio Google ${d.notizie.length} notizie, ${d.atti.length} atti e ${d.valori.length} valori`);
    return json({ notizie: d.notizie.length, atti: d.atti.length, valori: d.valori.length, testi: Object.keys(d.impostazioni).length });
  }

  return errore("Non trovato", 404);
};

export const config = { path: ["/api/admin", "/api/admin/*"] };
