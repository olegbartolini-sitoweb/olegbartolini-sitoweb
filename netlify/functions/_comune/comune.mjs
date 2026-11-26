/* Parti in comune tra le funzioni del pannello: archivio, accessi, controlli.
   L'archivio è Netlify Blobs (spazio dati privato del sito su Netlify). */

import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

/* ---------- archivio ---------- */
export const archivio = nome => getStore({ name: nome, consistency: "strong" });
const contenuti = () => archivio("contenuti");

export const VUOTO = () => ({ versione: 1, migrato: false, aggiornato: null, notizie: [], atti: [], impostazioni: {}, valori: [], registro: [] });

export async function leggiDati() {
  const d = await contenuti().get("dati", { type: "json" });
  return d ? { ...VUOTO(), ...d } : VUOTO();
}
export async function scriviDati(d, chi, cosa) {
  d.aggiornato = new Date().toISOString();
  d.migrato = true;
  if (chi && cosa) {
    d.registro = [{ quando: d.aggiornato, chi: chi.nome, cosa }, ...(d.registro || [])].slice(0, 100);
  }
  await contenuti().setJSON("dati", d);
  return d;
}

/* ---------- risposte ---------- */
export const json = (dati, stato = 200, intestazioni = {}) =>
  new Response(JSON.stringify(dati), { status: stato, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...intestazioni } });
export const errore = (messaggio, stato = 400) => json({ errore: messaggio }, stato);

/* ---------- utenti e password ---------- */
/* Primo accesso: l'utente "oleg" con una password consegnata a parte.
   Qui c'è solo l'impronta (hash) della password, non la password: dal codice non si può ricavare. */
const PRIMO_ADMIN = {
  id: "u-oleg", utente: "oleg", nome: "Oleg Bartolini", ruolo: "admin", versione: 1,
  salt: "85d753d1699dd2ca83848f8f02c72c58",
  hash: "fbb2bbf7db6be5ed98e623ec7913c928b9e6798b6ea763ab8f2bd05a44597234"
};

const impronta = (password, salt) =>
  new Promise((ok, ko) => crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? ko(e) : ok(k.toString("hex"))));

export async function nuovaImpronta(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: await impronta(password, salt) };
}
export async function passwordGiusta(utente, password) {
  if (!utente || typeof password !== "string") return false;
  const h = await impronta(password, utente.salt);
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(utente.hash, "hex"));
}
export function passwordCasuale() {
  const alfa = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let p = ""; for (let i = 0; i < 16; i++) p += alfa[crypto.randomInt(alfa.length)];
  return p.slice(0, 4) + "-" + p.slice(4, 8) + "-" + p.slice(8, 12) + "-" + p.slice(12);
}

export async function leggiUtenti() {
  const u = await archivio("accessi").get("utenti", { type: "json" });
  if (u && u.length) return u;
  await archivio("accessi").setJSON("utenti", [PRIMO_ADMIN]);
  return [PRIMO_ADMIN];
}
export const salvaUtenti = lista => archivio("accessi").setJSON("utenti", lista);
export const pubblico = u => ({ id: u.id, utente: u.utente, nome: u.nome, ruolo: u.ruolo });

/* ---------- sessione (cookie firmato) ---------- */
const COOKIE = "ob_admin";
const DURATA = 30 * 24 * 3600; /* 30 giorni */

async function segreto() {
  const s = archivio("accessi");
  let k = await s.get("segreto", { type: "text" });
  if (!k) { k = crypto.randomBytes(32).toString("hex"); await s.set("segreto", k); }
  return k;
}
const b64 = s => Buffer.from(s).toString("base64url");
const firma = (dati, k) => crypto.createHmac("sha256", k).update(dati).digest("base64url");

export async function cookieSessione(utente) {
  const corpo = b64(JSON.stringify({ u: utente.id, v: utente.versione || 1, e: Math.floor(Date.now() / 1000) + DURATA }));
  const token = corpo + "." + firma(corpo, await segreto());
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURATA}`;
}
export const cookieUscita = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/* restituisce l'utente collegato, oppure null */
export async function chiSei(req) {
  const c = (req.headers.get("cookie") || "").split(/;\s*/).find(x => x.startsWith(COOKIE + "="));
  if (!c) return null;
  const [corpo, f] = c.slice(COOKIE.length + 1).split(".");
  if (!corpo || !f) return null;
  const atteso = firma(corpo, await segreto());
  if (atteso.length !== f.length || !crypto.timingSafeEqual(Buffer.from(atteso), Buffer.from(f))) return null;
  let d; try { d = JSON.parse(Buffer.from(corpo, "base64url").toString()); } catch { return null; }
  if (!d || d.e < Date.now() / 1000) return null;
  const u = (await leggiUtenti()).find(x => x.id === d.u);
  return u && (u.versione || 1) === d.v ? u : null;
}

/* le richieste che cambiano qualcosa devono arrivare dal pannello stesso */
export const dalPannello = req => req.headers.get("x-pannello") === "1";

/* ---------- pulizia dei dati in ingresso ---------- */
export const testo = (v, max = 300) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
export const dataISO = s => {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
};
export const link = u => { u = testo(u, 2000); return /^https:\/\/\S+$/i.test(u) ? u : ""; };
export const fotoOk = u => { u = testo(u, 2000); return /^https:\/\/\S+$/i.test(u) || /^\/foto\/[\w-]+\.(jpg|png|webp)$/.test(u) || /^foto-notizie\/[\w.-]+$/.test(u) ? u : ""; };
export const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
export const nuovoId = (prefisso = "") => prefisso + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");

/* ---------- lettura dei vecchi fogli Google (per l'importazione) ---------- */
export function leggiCSV(t) {
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

/* ---------- atti: pannello + scheda "ATTI PRESENTATI" del Foglio Google ---------- */
const FOGLIO_ATTI = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsbM6PfC3ogxct0drD5LScDCwalsIzkJSF5WmSYBk5A9q34H3upzsd4L56U-12c1CRHMAVyrGDsIVb/pub?gid=487241243&single=true&output=csv";
export const norm = t => String(t || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
export function pulisciAtto(a) {
  return { data: dataISO(a.data), tipo: testo(a.tipo, 80) || "Atto", titolo: testo(a.titolo, 400), descrizione: testo(a.descrizione, 3000), esito: testo(a.esito, 120), pdf: link(a.pdf) };
}
export function attiDaCSV(righe) {
  const [int = [], ...rr] = righe;
  const col = n => int.findIndex(h => norm(h).startsWith(n));
  const k = { data: col("data"), tipo: col("tipo"), titolo: col("titolo"), descrizione: col("descr"), esito: col("esito"), pdf: col("link") >= 0 ? col("link") : col("pdf") };
  return rr.map(r => {
    const g = i => i >= 0 ? (r[i] || "").trim() : "";
    const a = pulisciAtto({ data: g(k.data), tipo: g(k.tipo), titolo: g(k.titolo), descrizione: g(k.descrizione), esito: g(k.esito), pdf: g(k.pdf) });
    return a.data && a.titolo ? a : null;
  }).filter(Boolean);
}
/* stesso atto = stessa data e stesso titolo (maiuscole, accenti e punteggiatura non contano) */
export const chiaveAtto = a => a.data + "|" + slug(a.titolo);

/* legge la scheda del Foglio; se Google non risponde usa l'ultima copia buona */
export async function attiDalFoglio() {
  const s = archivio("contenuti");
  try {
    const r = await fetch(FOGLIO_ATTI + "&t=" + Date.now(), { redirect: "follow", signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(r.status);
    const t = await r.text();
    if (/^\s*</.test(t)) throw new Error("risposta non valida");
    const lista = attiDaCSV(leggiCSV(t)).map((a, i) => ({ ...a, id: "f" + i, origine: "foglio" }));
    await s.setJSON("atti-foglio", { lista, quando: new Date().toISOString() });
    return { lista, ok: true };
  } catch (e) {
    const c = await s.get("atti-foglio", { type: "json" });
    return { lista: c ? c.lista : [], ok: false };
  }
}
/* tutti gli atti per il sito: quelli del Foglio + quelli del pannello che non sono già nel Foglio */
export function uniscitAtti(pannello, foglio) {
  const nelFoglio = new Set(foglio.map(chiaveAtto));
  return [...foglio, ...pannello.filter(a => !nelFoglio.has(chiaveAtto(a))).map(a => ({ ...a, origine: "pannello" }))];
}
