import type { FileEvidence } from "../email/evidence.js";

export const boardFolders = ["Email Alerts", "To Do", "Blocked", "Applied", "Cancelled", "Deferred"] as const;
export type BoardFolder = typeof boardFolders[number];
export type IntakeFolder = "Email Alerts" | "To Do";
export type TaskDecisionAction = "cancel" | "defer" | "resume" | "restore";
export interface TaskDecision {
  id: string;
  action: TaskDecisionAction;
  from: BoardFolder;
  to: BoardFolder;
  reason: string;
  actor: string;
  observedAt: string;
  authority: FileEvidence;
}
export function ticketFolder(path: string): BoardFolder {
  const match = /^Task Board\/([^/]+)\/([^/\\]+\.md)$/.exec(path);
  if (!match || !boardFolders.includes(match[1] as BoardFolder) || [".md", "readme.md"].includes(match[2].toLowerCase()) || /[:\x00-\x1f]/.test(match[2]) || match[2] === "..md") {
    throw new Error("Select one actual task path inside a supported board folder.");
  }
  return match[1] as BoardFolder;
}
export function validateDecision(d: TaskDecision): void {
  if (!d || ![d.id, d.reason, d.actor].every(v => typeof v === "string" && !!v.trim()) ||
    !Number.isFinite(Date.parse(d.observedAt)) || !boardFolders.includes(d.from) || !boardFolders.includes(d.to) ||
    !["cancel", "defer", "resume", "restore"].includes(d.action) || !d.authority?.path || !/^[a-f0-9]{64}$/.test(d.authority.sha256)) {
    throw new Error("Record the actual decision, actor, reason, time and saved authority.");
  }
  const destination = { cancel: "Cancelled", defer: "Deferred", resume: "To Do", restore: "To Do" };
  if (destination[d.action] !== d.to || d.action === "resume" && d.from !== "Deferred" || d.action === "restore" && d.from !== "Cancelled") {
    throw new Error("The decision must describe this exact transition.");
  }
}
const decisionMarker = "<!-- job-task-decision -->";
export function taskDecisionBlock(value: Record<string, unknown>) { return `${decisionMarker}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``; }
export function readDecisionSnapshot(bytes: Buffer): { taskId: string; messageKey?: string; vacancyKey?: string; decision: TaskDecision; task: unknown } {
  const body = bytes.toString("utf8"), at = body.lastIndexOf(decisionMarker);
  const match = at < 0 ? null : /^\s*```json\s*\n([\s\S]*?)\n```\s*$/.exec(body.slice(at + decisionMarker.length));
  if (!match) throw new Error("Preserve the exact task decision snapshot before source cleanup.");
  return JSON.parse(match[1]);
}
