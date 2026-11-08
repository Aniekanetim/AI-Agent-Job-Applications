import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { evidenceFile } from "../email/evidence.js";
import { savePrivateJson } from "../workflow/private-json.js";
import { accountProbe, publishingPath, recordScheduledCheck, type Draft } from "./store.js";
import { liveComposer, openComposer, openPublishingBrowser, prepareComposer } from "./browser.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP2cAAAAASUVORK5CYII=", "base64");
const video = Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex");
const fixtures = [
  { format: "text", media: undefined },
  { format: "image", media: { name: "rehearsal.png", bytes: png, kind: "image" as const } },
  { format: "video", media: { name: "rehearsal.mp4", bytes: video, kind: "video" as const } },
];

export async function exerciseComposer(root: string) {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><meta charset="utf-8"><title>Synthetic publishing rehearsal</title>
      <button id="me">Me</button><a href="/in/synthetic/" hidden>View profile</a>
      <button id="start"><span>Start a post</span></button>
      <dialog id="composer"><span>Post to Anyone</span><div role="textbox" contenteditable="true" style="min-height:2em"></div>
        <button id="media" aria-label="Media">Media</button><input id="file" type="file" hidden>
        <div id="previews"></div><button id="post" disabled>Post</button>
      </dialog>
      <a href="https://www.linkedin.com/feed/update/urn:li:activity:987654321/">View post</a>
      <div id="outcome" role="status"></div>
      <script>
        const get = id => document.getElementById(id);
        const editor = document.querySelector('[role=textbox]');
        get('me').onclick = () => { const link = document.querySelector('a'); link.hidden = !link.hidden; };
        get('start').onclick = () => get('composer').showModal();
        editor.oninput = () => { get('post').disabled = !editor.innerText.trim(); };
        get('media').onclick = () => get('file').click();
        get('file').onchange = () => {
          const file = get('file').files[0];
          const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
          element.src = URL.createObjectURL(file);
          element.style.width = '60px';
          element.style.height = '60px';
          get('previews').append(element);
        };
        get('post').onclick = () => {
          get('composer').close();
          const outcome = get('outcome');
          const confirmation = document.createElement('span');
          confirmation.textContent = 'Post successful';
          const link = document.createElement('a');
          link.href = 'https://www.linkedin.com/feed/update/urn:li:activity:123456789/';
          link.textContent = 'View post';
          outcome.append(confirmation, document.createElement('br'), link);
        };
      </script>`);
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const browser = await openPublishingBrowser(root);
    try {
      const page = await browser.newPage();
      const account = { profileUrl: `${origin}/in/synthetic/`, audience: "Anyone" as const };
      for (const fixture of fixtures) {
        const draft: Draft = { text: `Synthetic ${fixture.format} publishing rehearsal`, topic: "Synthetic", facts: ["synthetic"] };
        const prepared = await prepareComposer(page, account, draft, fixture.media, origin);
        await prepared.recheck();
        await prepared.click(3000);
        const result = await prepared.confirm();
        if (result.url !== "https://www.linkedin.com/feed/update/urn:li:activity:123456789/") {
          throw new Error("The synthetic composer did not return the link in its own confirmation.");
        }
      }
      let rejected = false;
      try { await openComposer(page, { ...account, profileUrl: `${origin}/in/other/` }, origin); }
      catch (error) { rejected = error instanceof Error && error.message === "The browser signed into a different LinkedIn profile."; }
      if (!rejected) throw new Error("The synthetic browser accepted the wrong profile.");
    } finally { await browser.close(); }
  } finally { await new Promise<void>(done => server.close(() => done())); }
  return { synthetic: true, verified: fixtures.map(fixture => fixture.format), checkedAt: new Date().toISOString() };
}

export async function publishingRehearsal(root: string, schedule?: { reference: string; runReference: string }) {
  const probe = schedule ? accountProbe(root) : null;
  if (schedule && (probe?.scheduleReference !== schedule.reference || !schedule.runReference.trim())) {
    throw new Error("Reference the actual dedicated publishing schedule and this scheduled invocation.");
  }
  const synthetic = await exerciseComposer(root);
  if (!schedule || !probe) return synthetic;
  const session = await liveComposer(root, probe.account);
  try { await openComposer(session.page, probe.account); }
  finally { await session.close(); }
  const prefix = `.local/publishing/evidence/rehearsal-${randomUUID()}`;
  const syntheticPath = `${prefix}-synthetic.json`, reportPath = `${prefix}-scheduled.json`;
  for (const path of [syntheticPath, reportPath]) publishingPath(root, path);
  savePrivateJson(root, syntheticPath, synthetic, null);
  savePrivateJson(root, reportPath, { executionContext: "scheduled", workingRoot: resolve(root),
    scheduleReference: schedule.reference, scheduleRunReference: schedule.runReference, revision: probe.revision,
    checkedAt: new Date().toISOString(), composerOpened: true,
    syntheticRehearsal: evidenceFile(root, syntheticPath) }, null);
  return recordScheduledCheck(root, evidenceFile(root, reportPath));
}
