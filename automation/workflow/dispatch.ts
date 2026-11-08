import { listContentTickets, listIntakeTickets } from "./intake.js";
import { readBoardConfig } from "../publishing/board-config.js";
import { readContentTicket } from "../publishing/board-tickets.js";

/** The agent dispatches these routes separately so one dependency cannot stop the other. */
export function boardWork(root: string) {
  const applicationRoute = () => {
    try { return { applications: listIntakeTickets(root).map(ticket => ({ ...ticket, kind: "application" as const })) }; }
    catch { return { applications: [], applicationIssue: "Reconcile the application intake folders." }; }
  };
  const application = applicationRoute();
  try {
    const mode = readBoardConfig(root).data?.mode ?? "off";
    const content = mode === "off" ? [] : listContentTickets(root).map(item => {
      try {
        const { ticket } = readContentTicket(root, item.path);
        return { kind: "content" as const, path: item.path, id: ticket.id, ready: ticket.ready, source: ticket.source };
      } catch {
        return { kind: "content" as const, path: item.path, ready: false, issue: "Reconcile the selected active content ticket." };
      }
    });
    return { ...application, content, contentMode: mode };
  } catch {
    return { ...application, content: [], contentMode: "unavailable", issue: "Reconcile the private content workflow." };
  }
}
