import { applicationIntakeFolders, listApplicationIntake, listContentTickets } from "./intake.js";
import type { IntakeFolder } from "./board.js";
import { readBoardConfig } from "../publishing/board-config.js";
import { readContentTicket, type ContentTicket } from "../publishing/board-tickets.js";
import { readBoardPost, type Post } from "../publishing/store.js";
import { digest } from "../email/evidence.js";

function contentGuidance(ticket: ContentTicket, post: Post | null) {
  if (post && ticket.ready && ticket.draftSha256 !== digest(JSON.stringify(post.draft))) {
    return { nextAction: "inspectCheckpoint", reasonCode: "publicationDraftMismatch", nextActionMessage: "Check the saved draft against the board ticket." };
  }
  if (post?.status === "attempted") {
    return { nextAction: "verifyAttempt", reasonCode: "publicationOutcomeUnknown", nextActionMessage: "Check whether the post went through." };
  }
  if (post?.status === "published") {
    return { nextAction: "finalizePublication", reasonCode: "publicationConfirmed", nextActionMessage: "Finish recording the confirmed post on the board." };
  }
  if (ticket.dependencies?.length || ticket.receipt) {
    return { nextAction: "inspectCheckpoint", reasonCode: "contentTicketNeedsReview", nextActionMessage: "Review the saved content ticket before continuing." };
  }
  if (!ticket.ready) {
    return { nextAction: "prepareContent", reasonCode: "draftNotPrepared", nextActionMessage: "Prepare or refresh the draft." };
  }
  if (!post || post.status === "skipped") {
    return { nextAction: "inspectCheckpoint", reasonCode: post ? "publicationDraftSkipped" : "publicationDraftMissing", nextActionMessage: "Review the saved draft checkpoint." };
  }
  return { nextAction: "checkPublicationEligibility", reasonCode: "draftPrepared", nextActionMessage: "Draft prepared. Publication checks are next." };
}

/** Lists active work and reports read-only recovery guidance. */
export function boardWork(root: string) {
  const applicationIssues: { folder: IntakeFolder; reasonCode: "intakeUnavailable"; message: string }[] = [];
  const applications = applicationIntakeFolders.flatMap(folder => {
    try { return listApplicationIntake(root, folder).map(ticket => ({ ...ticket, kind: "application" as const })); }
    catch {
      applicationIssues.push({ folder, reasonCode: "intakeUnavailable", message: `Check access to the ${folder} folder and its intake records.` });
      return [];
    }
  }).sort((a, b) => a.path.localeCompare(b.path));
  const application = {
    applications, applicationIssues,
    ...(applicationIssues.length ? { applicationIssue: "Reconcile the application intake folders." } : {}),
  };
  try {
    const mode = readBoardConfig(root).data?.mode ?? "off";
    const content = mode === "off" ? [] : listContentTickets(root).map(item => {
      try {
        const { ticket } = readContentTicket(root, item.path);
        const details = { kind: "content" as const, path: item.path, id: ticket.id, ready: ticket.ready, source: ticket.source };
        try { return { ...details, ...contentGuidance(ticket, readBoardPost(root, ticket.id)) }; }
        catch {
          return { ...details, nextAction: "inspectCheckpoint", reasonCode: "publicationCheckpointUnreadable",
            nextActionMessage: "Inspect the saved publishing checkpoint." };
        }
      } catch {
        return { kind: "content" as const, path: item.path, ready: false, issue: "Reconcile the selected active content ticket.",
          nextAction: "inspectCheckpoint", reasonCode: "contentTicketUnreadable", nextActionMessage: "Inspect the selected content ticket." };
      }
    });
    return { ...application, content, contentMode: mode };
  } catch {
    return { ...application, content: [], contentMode: "unavailable", issue: "Reconcile the private content workflow." };
  }
}
