import { acquireOwnership, OwnershipBusy } from "../workflow/ownership.js";
import { dispatchKey, inspectRun, prepareMedia, publishingWorker, recordAttempt, confirmPost, type RunRequest, type Receipt } from "./store.js";
import { slotMs } from "./schedule.js";
import { liveComposer, prepareComposer } from "./browser.js";

type Target = NonNullable<ReturnType<typeof inspectRun>>;
type Prepared = { recheck(): Promise<void>; click(remaining: number): Promise<void>; confirm(): Promise<Receipt>; close(): Promise<void> };
type Prepare = (root: string, target: Target, media: ReturnType<typeof prepareMedia>) => Promise<Prepared>;
const systemTime = () => new Date().toISOString();

const prepareLive: Prepare = async (root, target, media) => {
  const session = await liveComposer(root, target.account);
  try {
    const prepared = await prepareComposer(session.page, target.account, target.post.draft, media);
    return { ...prepared, close: session.close };
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
};

export async function publish(root: string, request: RunRequest, prepare: Prepare = prepareLive, now = systemTime) {
  if (!inspectRun(root, request, now())) return { action: "idle" as const };
  let worker;
  try { worker = acquireOwnership(root, publishingWorker); }
  catch (error) {
    if (error instanceof OwnershipBusy) return { action: "busy" as const };
    throw error;
  }
  let prepared: Prepared | undefined;
  try {
    const target = inspectRun(root, request, now());
    if (!target) return { action: "idle" as const };
    try {
      prepared = await prepare(root, target, prepareMedia(root, target.post.draft));
      await prepared.recheck();
    } catch {
      return { action: "composerNeedsAttention" as const, postId: target.post.id };
    }
    const dispatch = acquireOwnership(root, dispatchKey, { waitMs: 1000 });
    let attempt;
    try {
      const at = now();
      attempt = recordAttempt(root, dispatch, request, target, at);
      if (!attempt) return { action: "changedBeforeClick" as const, postId: target.post.id };
      const remaining = request.kind === "scheduled" ? Date.parse(target.post.slot!.at) + slotMs - Date.parse(now()) : 3000;
      if (remaining <= 0) return { action: "verifyAttempt" as const, postId: target.post.id, attemptId: attempt.id };
      try { await prepared.click(remaining); }
      catch { return { action: "verifyAttempt" as const, postId: target.post.id, attemptId: attempt.id }; }
    } finally { dispatch.release(); }
    try {
      const receipt = await prepared.confirm();
      confirmPost(root, worker, target.post.id, attempt.id, receipt);
      return { action: "published" as const, postId: target.post.id, receipt };
    } catch {
      return { action: "verifyAttempt" as const, postId: target.post.id, attemptId: attempt.id };
    }
  } finally {
    if (prepared) await prepared.close().catch(() => {});
    worker.release();
  }
}
