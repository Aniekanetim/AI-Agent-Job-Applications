import { type ConnectionInventory, validateInventory, type EmailConnection } from "./connection.js";

export type Harness = "codex" | "claudeCode" | "other" | "unknown";
export type ProviderAvailability = "available" | "restricted" | "unsupported" | "unknown";
export interface ProviderEntry {
  id: string;
  displayName: string;
  availability: ProviderAvailability;
  connectionRoute: "harness" | "agentmail" | null;
  evidenceReference: string;
  reason: string | null;
}
export interface ProviderCatalog {
  schemaVersion: 1;
  harness: Harness;
  workingRoot: string;
  executionContext: "interactive" | "scheduled";
  checkedAt: string;
  discovery: "complete" | "partial" | "unavailable";
  providers: ProviderEntry[];
}
const labels: Record<string, string> = {
  gmail: "Google — Gmail / Google Workspace",
  outlook: "Microsoft — Outlook / Microsoft 365",
  agentmail: "AgentMail",
};
const aliases = new Map([["google-workspace", "gmail"], ["outlook-email", "outlook"], ["microsoft-365", "outlook"]]);
export const providerId = (id: string) => aliases.get(id) ?? id;
export const providerLabel = (id: string) => Object.hasOwn(labels, id) ? labels[id] : id;
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1000 && !/[\r\n\0]/.test(v);
const keys = (v: object, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key));

export function validateProviderCatalog(value: unknown): asserts value is ProviderCatalog {
  const c = value as ProviderCatalog;
  if (!c || c.schemaVersion !== 1 || !keys(c, ["schemaVersion", "harness", "workingRoot", "executionContext", "checkedAt", "discovery", "providers"]) ||
    !["codex", "claudeCode", "other", "unknown"].includes(c.harness) || !text(c.workingRoot) ||
    !["interactive", "scheduled"].includes(c.executionContext) || !Number.isFinite(Date.parse(c.checkedAt)) ||
    !["complete", "partial", "unavailable"].includes(c.discovery) || !Array.isArray(c.providers)) throw new Error("Record the actual harness, discovery scope and observation time without credentials.");
  const ids = new Set<string>();
  for (const p of c.providers) {
    if (!p || !keys(p, ["id", "displayName", "availability", "connectionRoute", "evidenceReference", "reason"]) ||
      !text(p.id) || !/^[a-z][a-z0-9-]{0,79}$/.test(p.id) || providerId(p.id) !== p.id || ids.has(p.id) || !text(p.displayName) ||
      !["available", "restricted", "unsupported", "unknown"].includes(p.availability) ||
      ![null, "harness", "agentmail"].includes(p.connectionRoute) || !text(p.evidenceReference) ||
      !(p.reason === null || text(p.reason)) || (["restricted", "unsupported"].includes(p.availability) && !p.reason) ||
      (p.availability === "available" && (p.connectionRoute === null || c.discovery === "unavailable")) ||
      (p.id === "agentmail" ? p.connectionRoute !== "agentmail" : p.connectionRoute === "agentmail")) throw new Error("Provider options need unique IDs, actual availability evidence and a supported connection route.");
    ids.add(p.id);
  }
}

/** Normalize catalog metadata only. No account, login or capability is inferred. */
export function normalizeCodexCatalog(input: unknown, format: "codexCli" | "codexDirectory", root: string, now: string, reference: string): ProviderCatalog {
  const raw = input as Record<string, unknown>;
  if (!raw || (format === "codexCli" ? !Array.isArray(raw.installed) || !Array.isArray(raw.available) : !Array.isArray(raw.plugins))) throw new Error("Use the actual documented Codex catalog response; preserve unfamiliar formats for inspection.");
  // Exact service names prevent a calendar plugin or a Gmail mention in an unrelated description becoming an email provider.
  const known = new Map([["gmail", "gmail"], ["outlook-email", "outlook"]]);
  const entries = format === "codexCli" ? [...raw.available as unknown[], ...raw.installed as unknown[]] : raw.plugins as unknown[];
  const providers = new Map<string, ProviderEntry>();
  for (const value of entries) {
    const plugin = value as Record<string, unknown> | null;
    if (!plugin || typeof plugin.name !== "string" || !known.has(plugin.name)) continue;
    const id = known.get(plugin.name)!;
    const restricted = ["BLOCKED", "DENIED", "DISALLOWED"].includes(String(plugin.installPolicy ?? plugin.installation_policy).toUpperCase()) ||
      ["BLOCKED", "DISABLED"].includes(String(plugin.status).toUpperCase()) || (plugin.installed === true && plugin.enabled === false);
    const next: ProviderEntry = { id, displayName: labels[id], availability: restricted ? "restricted" : "available",
      connectionRoute: "harness", evidenceReference: reference, reason: restricted ? "The harness reports this integration as disabled or restricted. Check its connection settings." : null };
    // The installed entry describes local state more precisely than the marketplace entry.
    providers.set(id, next);
  }
  const catalog: ProviderCatalog = { schemaVersion: 1, harness: "codex", workingRoot: root, executionContext: "interactive", checkedAt: now,
    discovery: "partial", providers: [...providers.values()] };
  validateProviderCatalog(catalog); return catalog;
}

export interface ProviderOption {
  id: string;
  label: string;
  availability: ProviderAvailability;
  action: string;
  accounts: { id: string; address: string | null; authentication: string; action: string }[];
  selected: boolean;
}
export function providerOptions(catalog: ProviderCatalog | null, inventory: ConnectionInventory | null, selected: EmailConnection | null,
  root: string, context: "interactive" | "scheduled" = "interactive"): ProviderOption[] {
  if (catalog) validateProviderCatalog(catalog);
  if (inventory) validateInventory(inventory);
  const current = catalog?.workingRoot === root && catalog.executionContext === context ? catalog : null;
  const entries = new Map((current?.providers ?? []).map(p => [p.id, p]));
  const ids = new Set(["gmail", ...[...entries.values()].filter(p => p.availability === "available").map(p => p.id), "agentmail"]);
  for (const candidate of inventory?.candidates ?? []) ids.add(providerId(candidate.source.provider));
  if (selected) ids.add(providerId(selected.source.provider));
  const options = [...ids].map(id => {
    const entry = entries.get(id);
    const accounts = (inventory?.candidates ?? []).filter(c => providerId(c.source.provider) === id).map(c => {
      const authentication = c.authentication ?? "unverified";
      return { id: c.id, address: c.source.address, authentication,
        action: !c.available || authentication === "denied" ? "Check access" : authentication === "needsAuthentication" ? "Reconnect" :
          authentication === "connected" ? "Use existing connection" : "Verify connection" };
    });
    const availability = entry?.availability ?? "unknown";
    const selectedHere = selected !== null && providerId(selected.source.provider) === id;
    return { id, label: Object.hasOwn(labels, id) ? labels[id] : entry?.displayName ?? id, availability,
      action: selectedHere ? "Continue saved setup" : accounts.length ? "Choose an account" : id === "agentmail" ? "Set up a dedicated inbox" :
        availability === "available" ? "Connect" : availability === "restricted" ? "Check access" : availability === "unsupported" ? "Unavailable in this environment" : "Not yet verified",
      accounts, selected: selectedHere };
  });
  const order = (id: string) => id === "gmail" ? 0 : id === "outlook" ? 1 : id === "agentmail" ? 3 : 2;
  options.sort((a, b) => order(a.id) - order(b.id) || a.label.localeCompare(b.label));
  return options;
}

export function formatProviderOptions(options: ProviderOption[]): string {
  return ["Connect your email", "", ...options.flatMap((p, index) => [
    `${index + 1}. ${p.label} — ${p.action}${p.selected ? " (saved choice)" : ""}`,
    ...p.accounts.map(a => `   ${a.address ?? a.id} — ${a.action}`),
  ]), `${options.length + 1}. Set up email later — continue with manual tasks`,
    "", "A provider being available does not establish account connection or email readiness."].join("\n");
}
