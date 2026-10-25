import type { EvidenceReference } from "../onboarding/progress.js";
import type { BrowserBackend } from "./preferences.js";
export const browserOperations = ["navigation", "formFilling", "fileUpload", "outcomeInspection"] as const;
export type BrowserOperation = typeof browserOperations[number];
export interface CapabilityCheck {
  status: "verified" | "unsupported" | "unverified" | "denied";
  evidence: EvidenceReference[];
  reason: string | null;
}
export interface BrowserCapabilityReport {
  schemaVersion: 1;
  backend: BrowserBackend;
  providerId: string;
  workingRoot: string;
  executionContext: "interactive" | "scheduled";
  checkedAt: string;
  capabilities: Record<BrowserOperation, CapabilityCheck>;
}
export function validateCapabilityReport(value: unknown): asserts value is BrowserCapabilityReport {
  const data = value as BrowserCapabilityReport;
  if (!data || data.schemaVersion !== 1 || !["inApp", "playwright"].includes(data.backend) ||
    !data.providerId?.trim() || !data.workingRoot?.trim() || !["interactive", "scheduled"].includes(data.executionContext) ||
    !Number.isFinite(Date.parse(data.checkedAt)) || !data.capabilities) throw new Error("Browser capability evidence is incomplete.");
  for (const operation of browserOperations) {
    const check = data.capabilities[operation];
    if (!check || !["verified", "unsupported", "unverified", "denied"].includes(check.status) ||
      !Array.isArray(check.evidence) || check.evidence.some(ref => !ref || !ref.path || !/^[a-f0-9]{64}$/.test(ref.sha256)) ||
      !(check.reason === null || typeof check.reason === "string") ||
      (check.status === "verified" && !check.evidence.length) ||
      (["unsupported", "denied"].includes(check.status) && (!check.reason?.trim() || !check.evidence.length))) throw new Error("Each claimed browser capability needs its actual evidence or limitation.");
  }
}
export function capabilityIssues(report: BrowserCapabilityReport, root: string,
  context: "interactive" | "scheduled", requireUpload: boolean): string[] {
  validateCapabilityReport(report);
  const issues: string[] = [];
  if (report.workingRoot !== root || report.executionContext !== context) issues.push("Reverify browser access in this working copy and execution context.");
  for (const operation of browserOperations) {
    if (operation === "fileUpload" && !requireUpload && report.capabilities[operation].status !== "denied") continue;
    if (report.capabilities[operation].status !== "verified") issues.push(`${report.backend}: ${operation} is ${report.capabilities[operation].status}.`);
  }
  return issues;
}
