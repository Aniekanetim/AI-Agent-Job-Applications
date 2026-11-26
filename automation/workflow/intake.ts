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

export const applicationIntakeFolders = ["Email Alerts", "To Do"] as const satisfies readonly IntakeFolder[];

function listBoardFolder(root: string, folder: IntakeFolder | "Content Creation", readDirectory: typeof fs.readdirSync) {
  const directory = resolve(root, "Task Board", folder);
  for (const path of [resolve(root, "Task Board"), directory]) {
    try {
      const stat = fs.lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Use the actual intake folders in this private board.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  return readDirectory(directory, { withFileTypes: true });
}

/** Routine intake lists active folders and uses only content identity metadata. */
export function listApplicationIntake(root: string, folder: IntakeFolder, readDirectory: typeof fs.readdirSync = fs.readdirSync): IntakeTicket[] {
  return listBoardFolder(root, folder, readDirectory)
    .filter(entry => entry.isFile() && entry.name.endsWith(".md") && entry.name.toLowerCase() !== "readme.md" && !registeredContentTicketId(root, entry.name))
    .map(entry => ({ folder, path: `Task Board/${folder}/${entry.name}`, name: entry.name }));
}

export function listIntakeTickets(root: string, readDirectory: typeof fs.readdirSync = fs.readdirSync): IntakeTicket[] {
  return applicationIntakeFolders.flatMap(folder => listApplicationIntake(root, folder, readDirectory))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function listContentTickets(root: string): ContentIntakeTicket[] {
  return listBoardFolder(root, "Content Creation", fs.readdirSync)
    .filter(entry => entry.isFile() && contentTicketName.test(entry.name))
    .map(entry => ({ folder: "Content Creation" as const, path: `Task Board/Content Creation/${entry.name}`, name: entry.name }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
