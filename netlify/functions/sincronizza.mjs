/* Ogni 15 minuti: le righe nuove della scheda ATTI PRESENTATI entrano nel pannello. */
import { leggiDati, sincronizzaAtti } from "./_comune/comune.mjs";

export default async () => {
  const d = await leggiDati();
  const n = await sincronizzaAtti(d);
  console.log(`Atti aggiunti dal Foglio: ${n}`);
};

export const config = { schedule: "*/15 * * * *" };
