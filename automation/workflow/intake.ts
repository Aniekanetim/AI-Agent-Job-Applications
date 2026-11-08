import fs from "node:fs";
import { resolve } from "node:path";
import type { IntakeFolder } from "./application-state.js";
import { digest } from "../email/evidence.js";
import { readPrivateJson } from "./private-json.js";

export interface IntakeTicket { folder: IntakeFolder; path: string; name: string }
export interface ContentIntakeTicket { folder: "Content Creation"; path: string; name: string }
const contentTicketName = /^CONTENT-([a-zA-Z0-9_-]{1,100})\.md$/i;
export const contentIdentityPath = (id: string) => `.local/publishing/ticket-ids/${digest(id)}.json`;
export function contentIdentityExists(root: string, id: string) {
  const { data } = readPrivateJson(root, contentIdentityPath(id));
  return (data as { id?: string } | null)?.id === id;
}
export function registeredContentTicketId(root: string, name: string) {
  const id = contentTicketName.exec(name)?.[1];
  return id && contentIdentityExists(root, id) ? `CONTENT-${id}` : null;
}

/** Routine intake has no Blocked traversal, linked-context reads or hash sweep. */
export function listIntakeTickets(root: string, readDirectory: typeof fs.readdirSync = fs.readdirSync): IntakeTicket[] {
  const tickets: IntakeTicket[] = [];
  for (const folder of ["Email Alerts", "To Do"] as const) {
    const directory = resolve(root, "Task Board", folder);
    if (!fs.existsSync(directory)) continue;
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "readme.md" || registeredContentTicketId(root, entry.name)) continue;
      tickets.push({ folder, path: `Task Board/${folder}/${entry.name}`, name: entry.name });
    }
  }
  return tickets.sort((a, b) => a.path.localeCompare(b.path));
}

export function listContentTickets(root: string): ContentIntakeTicket[] {
  for (const part of ["Task Board", "Task Board/Content Creation"]) {
    try {
      const stat = fs.lstatSync(resolve(root, part));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Use the actual Content Creation folder in this private board.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  return fs.readdirSync(resolve(root, "Task Board/Content Creation"), { withFileTypes: true })
    .filter(entry => entry.isFile() && contentTicketName.test(entry.name))
    .map(entry => ({ folder: "Content Creation" as const, path: `Task Board/Content Creation/${entry.name}`, name: entry.name }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
