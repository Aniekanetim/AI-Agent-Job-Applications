import { postingUrl, inventoryPostings } from "./inventory-shape.js";
export { postingUrl, inventoryPostings } from "./inventory-shape.js";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { readEvidence, type FileEvidence } from "./evidence.js";

export interface SourceCapture {
  schemaVersion: 1;
  messageKey: string;
  completeness: "full" | "truncated" | "unknown";
  observedAt: string;
  toolReference: string;
  html?: string;
  text?: string;
}
export interface SourceLink { candidateId: string; href: string }
export interface LinkDecision {
  candidateId: string;
  kind: "posting" | "navigation" | "unresolved";
  vacancyKey?: string;
  postingUrl?: string;
  reason?: string;
  evidence?: FileEvidence;
}
export interface AlertInventory {
  schemaVersion: 1;
  messageKey: string;
  source: FileEvidence;
  candidates: SourceLink[];
  decisions: LinkDecision[];
}
const supplied = (v: unknown): v is string => typeof v === "string" && !!v.trim();
export function validateCapture(value: unknown): asserts value is SourceCapture {
  const c = value as SourceCapture;
  if (!c || c.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(c.messageKey) || !["full", "truncated", "unknown"].includes(c.completeness) ||
    !Number.isFinite(Date.parse(c.observedAt)) || !supplied(c.toolReference) || !(typeof c.html === "string" || typeof c.text === "string") ||
    (c.html !== undefined && typeof c.html !== "string") || (c.text !== undefined && typeof c.text !== "string")) throw new Error("Capture the exact message's actual content, completeness and tool observation before mapping vacancies.");
}
export function sourceLinks(capture: SourceCapture): SourceLink[] {
  validateCapture(capture);
  const links: SourceLink[] = [];
  if (capture.html) {
    const visit = (node: DefaultTreeAdapterTypes.Node) => {
      if ("attrs" in node) for (const attr of node.attrs) if (["href", "action", "data-href", "data-url"].includes(attr.name)) {
        links.push({ candidateId: `html-${links.length + 1}`, href: attr.value.trim() });
      }
      if ("childNodes" in node) node.childNodes.forEach(visit);
      if ("content" in node) visit(node.content);
    };
    visit(parseFragment(capture.html));
  }
  if (capture.text) {
    let i = 0;
    for (const match of capture.text.matchAll(/https?:\/\/[^\s<>"']+/g)) links.push({ candidateId: `text-${++i}`, href: match[0] });
  }
  return links;
}
export function createInventory(root: string, source: FileEvidence): AlertInventory {
  const capture = JSON.parse(readEvidence(root, source).toString("utf8")); validateCapture(capture);
  const candidates = sourceLinks(capture);
  return { schemaVersion: 1, messageKey: capture.messageKey, source, candidates,
    decisions: candidates.map(link => ({ candidateId: link.candidateId, kind: "unresolved" })) };
}

export function verifyInventory(root: string, inventory: AlertInventory, expectedMessageKey: string): Map<string, string> {
  const capture = JSON.parse(readEvidence(root, inventory.source).toString("utf8")); validateCapture(capture);
  if (capture.messageKey !== expectedMessageKey || inventory.messageKey !== expectedMessageKey || capture.completeness !== "full" ||
    JSON.stringify(sourceLinks(capture)) !== JSON.stringify(inventory.candidates)) throw new Error("The full source message and extracted link inventory do not agree. Keep the alert for reconciliation.");
  const jobs = inventoryPostings(inventory);
  if (!jobs) throw new Error("Resolve every source link and identify each distinct vacancy before cleanup.");
  for (const d of inventory.decisions) {
    const bytes = readEvidence(root, d.evidence!);
    const href = inventory.candidates.find(c => c.candidateId === d.candidateId)!.href;
    if (d.kind === "posting") {
      let direct = false; try { direct = postingUrl(href) === postingUrl(d.postingUrl!); } catch { /* A relative/tracking link needs observed resolution. */ }
      if (!direct) {
        const observation = JSON.parse(bytes.toString("utf8"));
        if (observation.sourceHref !== href || observation.postingUrl !== postingUrl(d.postingUrl!) || !Number.isFinite(Date.parse(observation.observedAt))) throw new Error("A redirected or relative link needs its own matching observed posting destination.");
      }
    }
  }
  return jobs;
}
