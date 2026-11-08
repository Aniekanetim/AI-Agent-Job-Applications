import { digest } from "../email/evidence.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import type { Receipt } from "./store.js";

type Entry = { id: string; account: string; fingerprint: string; topic: string; angle: string; receipt: Receipt };
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const base = (account: string) => `.local/publishing/history/${digest(normalized(account))}`;
export const postFingerprint = (text: string) => digest(normalized(text));
const exactPath = (account: string, fingerprint: string) => `${base(account)}/text/${fingerprint.slice(0, 2)}/${fingerprint}.json`;
const anglePath = (account: string, topic: string, angle: string) => `${base(account)}/angle/${digest(JSON.stringify([normalized(topic), normalized(angle)]))}.json`;
const pendingPath = (account: string, fingerprint: string) => `${base(account)}/pending/${fingerprint}.json`;
const topicPath = (account: string, topic: string) => `${base(account)}/topic/${digest(normalized(topic))}.json`;

export function historyMatch(root: string, account: string, text: string, topic: string, angle: string) {
  const exact = readPrivateJson(root, exactPath(account, postFingerprint(text))).data as Entry | null;
  const sameAngle = readPrivateJson(root, anglePath(account, topic, angle)).data as Entry | null;
  return { exact, sameAngle, recent: shortlist(root, topicPath(account, topic)) };
}

export function recentContent(root: string, account: string) {
  return shortlist(root, `${base(account)}/recent.json`);
}

function shortlist(root: string, path: string) {
  const result = readPrivateJson(root, path).data as Entry[] | null;
  if (result !== null && (!Array.isArray(result) || result.length > 12)) throw new Error("Preserve the content history index for repair.");
  return result ?? [];
}

export function recordPublishedHistory(root: string, entry: Entry) {
  return withWriteOwnership(root, `publishing-history:${digest(normalized(entry.account))}`, () => {
    for (const path of [exactPath(entry.account, entry.fingerprint), anglePath(entry.account, entry.topic, entry.angle)]) {
      const loaded = readPrivateJson(root, path);
      if (!loaded.data) savePrivateJson(root, path, entry, loaded.revision);
    }
    for (const path of [`${base(entry.account)}/recent.json`, topicPath(entry.account, entry.topic)]) {
      const previous = readPrivateJson(root, path), recent = shortlist(root, path);
      const next = [...recent.filter(old => old.id !== entry.id), entry]
        .sort((a, b) => b.receipt.observedAt.localeCompare(a.receipt.observedAt) || b.id.localeCompare(a.id)).slice(0, 12);
      if (JSON.stringify(recent) !== JSON.stringify(next)) savePrivateJson(root, path, next, previous.revision);
    }
  });
}

export function pendingPublication(root: string, account: string, fingerprint: string) {
  return readPrivateJson(root, pendingPath(account, fingerprint)).data as { id: string } | null;
}

export function reservePublication(root: string, account: string, fingerprint: string, id: string) {
  const path = pendingPath(account, fingerprint), loaded = readPrivateJson(root, path);
  const pending = loaded.data as { id: string } | null;
  if (pending && pending.id !== id) throw new Error("Investigate the existing publication of this content.");
  if (!pending) savePrivateJson(root, path, { id }, loaded.revision);
}

export function releasePublication(root: string, account: string, fingerprint: string, id: string) {
  const path = pendingPath(account, fingerprint), loaded = readPrivateJson(root, path);
  if ((loaded.data as { id: string } | null)?.id === id) savePrivateJson(root, path, null, loaded.revision);
}
