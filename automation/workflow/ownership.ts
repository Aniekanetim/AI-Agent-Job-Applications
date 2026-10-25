import { openSync, closeSync, fsyncSync, writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export class OwnershipBusy extends Error {
  constructor() { super("Another worker owns this operation. Preserve the checkpoint and resume after it finishes."); this.name = "OwnershipBusy"; }
}
interface Owner { schemaVersion: 1; token: string; kind: "process" | "native"; ownerId: string; host: string; pid: number; startedAt: string }
export interface Ownership { token: string; ownerId: string; assertOwned(): void; release(): void }
const scopes = new WeakMap<Ownership, { root: string; key: string }>();
const normalizedRoot = (root: string) => { const value = realpathSync(root); return process.platform === "win32" ? value.toLowerCase() : value; };
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const host = () => createHash("sha256").update(hostname()).digest("hex");
function ignored(root: string, name: string) {
  // A transient Git process/I/O failure never counts as a successful privacy check.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", name], { windowsHide: true }); return; }
    catch { if (attempt < 2) pause(40); }
  }
  throw new Error("Operation ownership must be ignored by Git; its exclusion could not be verified.");
}
function location(root: string, key: string) {
  const folder = resolve(root, ".local/ownership"); mkdirSync(folder, { recursive: true });
  const part = relative(realpathSync(root), realpathSync(folder));
  if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("Operation ownership must stay in this working copy.");
  const name = `.local/ownership/${createHash("sha256").update(key).digest("hex")}.json`;
  if (execFileSync("git", ["-C", root, "ls-files", "--", name], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Operation ownership must be private and untracked.");
  ignored(root, name);
  return resolve(root, name);
}
function read(path: string): Owner | null {
  if (!existsSync(path)) return null;
  try {
    const owner = JSON.parse(readFileSync(path, "utf8")) as Owner;
    if (owner.schemaVersion !== 1 || !owner.token || !owner.ownerId || !["process", "native"].includes(owner.kind) ||
      !owner.host || !Number.isInteger(owner.pid) || owner.pid < 1 || !Number.isFinite(Date.parse(owner.startedAt))) throw new Error();
    return owner;
  } catch { throw new Error("Ownership metadata is incomplete. Preserve it and establish the previous worker's outcome before recovery."); }
}
function writeExclusive(path: string, owner: Owner) {
  const descriptor = openSync(path, "wx", 0o600);
  try { writeFileSync(descriptor, JSON.stringify(owner)); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function ended(owner: Owner) {
  if (owner.kind !== "process" || owner.host !== host()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
function recoverDeadProcess(path: string) {
  const previous = read(path);
  if (!previous || !ended(previous)) return false;
  const guard = `${path}.recovery`;
  const recovery: Owner = { schemaVersion: 1, token: randomUUID(), kind: "process", ownerId: "local-recovery", host: host(), pid: process.pid, startedAt: new Date().toISOString() };
  try { writeExclusive(guard, recovery); } catch { return false; }
  try { const old = read(path); if (old && ended(old)) { unlinkSync(path); return true; } return false; }
  finally { if (read(guard)?.token === recovery.token) unlinkSync(guard); }
}
function handle(root: string, key: string, path: string, owner: Owner): Ownership {
  const result: Ownership = { token: owner.token, ownerId: owner.ownerId,
    assertOwned() { if (read(path)?.token !== owner.token || existsSync(`${path}.recovery`)) throw new OwnershipBusy(); },
    release() { if (read(path)?.token !== owner.token) throw new OwnershipBusy(); unlinkSync(path); },
  };
  scopes.set(result, { root: normalizedRoot(root), key }); return result;
}
export function assertOperationOwnership(root: string, key: string, owner: Ownership) {
  const scope = scopes.get(owner);
  if (!scope || scope.root !== normalizedRoot(root) || scope.key !== key) throw new OwnershipBusy();
  owner.assertOwned();
}
export function acquireOwnership(root: string, key: string, options: { kind?: "process" | "native"; ownerId?: string; waitMs?: number } = {}): Ownership {
  const path = location(root, key), until = Date.now() + (options.waitMs ?? 0);
  const owner: Owner = { schemaVersion: 1, token: randomUUID(), kind: options.kind ?? "process", ownerId: options.ownerId ?? randomUUID(), host: host(), pid: process.pid, startedAt: new Date().toISOString() };
  do {
    if (!existsSync(`${path}.recovery`)) {
      try {
        writeExclusive(path, owner);
        if (existsSync(`${path}.recovery`)) { if (read(path)?.token === owner.token) unlinkSync(path); }
        else return handle(root, key, path, owner);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (existsSync(path) && recoverDeadProcess(path)) continue;
    }
    if (Date.now() >= until) break;
    pause(20);
  } while (true);
  throw new OwnershipBusy();
}
export function resumeNativeOwnership(root: string, key: string, token: string, ownerId: string): Ownership {
  const path = location(root, key), owner = read(path);
  if (!owner || owner.kind !== "native" || owner.token !== token || owner.ownerId !== ownerId) throw new OwnershipBusy();
  const result = handle(root, key, path, owner); result.assertOwned(); return result;
}
export function withWriteOwnership<T>(root: string, key: string, action: () => T): T {
  const owner = acquireOwnership(root, `write:${key}`, { waitMs: 5000 });
  try { return action(); } finally { owner.release(); }
}
