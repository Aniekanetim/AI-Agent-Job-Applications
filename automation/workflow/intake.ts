import fs from "node:fs";
import { resolve } from "node:path";
import type { IntakeFolder } from "./application-state.js";

export interface IntakeTicket { folder: IntakeFolder; path: string; name: string }

/** Routine intake has no Blocked traversal, linked-context reads or hash sweep. */
export function listIntakeTickets(root: string, readDirectory: typeof fs.readdirSync = fs.readdirSync): IntakeTicket[] {
  const tickets: IntakeTicket[] = [];
  for (const folder of ["Email Alerts", "To Do"] as const) {
    const directory = resolve(root, "Task Board", folder);
    if (!fs.existsSync(directory)) continue;
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "readme.md") continue;
      tickets.push({ folder, path: `Task Board/${folder}/${entry.name}`, name: entry.name });
    }
  }
  return tickets.sort((a, b) => a.path.localeCompare(b.path));
}
