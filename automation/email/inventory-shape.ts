export type { AlertInventory } from "./inventory.js";
import type { AlertInventory } from "./inventory.js";
const supplied = (v: unknown): v is string => typeof v === "string" && !!v.trim();
export function postingUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use the observed HTTPS posting URL without embedded credentials.");
  // Query and fragment may identify a job. Never strip them by a generic tracking rule.
  return url.href;
}
/** Structural reconciliation is necessary but never substitutes for source/evidence verification. */
export function inventoryPostings(inventory: AlertInventory | undefined): Map<string, string> | null {
  try {
    if (!inventory || inventory.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(inventory.messageKey) || !Array.isArray(inventory.candidates) ||
      !Array.isArray(inventory.decisions) || !inventory.candidates.length || inventory.candidates.length !== inventory.decisions.length) return null;
    const ids = new Set(inventory.candidates.map(c => c.candidateId));
    if (ids.size !== inventory.candidates.length || inventory.candidates.some(c => !supplied(c.candidateId) || typeof c.href !== "string")) return null;
    const seen = new Set<string>(), jobs = new Map<string, string>(), urls = new Map<string, string>();
    for (const d of inventory.decisions) {
      if (!ids.has(d.candidateId) || seen.has(d.candidateId) || d.kind === "unresolved" || !["posting", "navigation"].includes(d.kind) || !d.evidence) return null;
      seen.add(d.candidateId);
      if (d.kind === "navigation") { if (!supplied(d.reason)) return null; continue; }
      if (!supplied(d.vacancyKey) || !supplied(d.postingUrl)) return null;
      const url = postingUrl(d.postingUrl);
      if (jobs.has(d.vacancyKey) && jobs.get(d.vacancyKey) !== url || urls.has(url) && urls.get(url) !== d.vacancyKey) return null;
      jobs.set(d.vacancyKey, url); urls.set(url, d.vacancyKey);
    }
    return jobs.size ? jobs : null;
  } catch { return null; }
}
