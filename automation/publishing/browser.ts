import type { Browser, Locator, Page } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { publishingPath, type Draft, type Receipt, type accountProbe, type prepareMedia } from "./store.js";

type Account = ReturnType<typeof accountProbe>["account"];
type Media = ReturnType<typeof prepareMedia>;
const linkedIn = "https://www.linkedin.com";
const timeout = 12_000;
const normalized = (value: string) => value.replace(/\r\n/g, "\n").trim();
const postLink = (value: string) => /^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:(?:activity|ugcPost|share):\d+\/?$/.test(value);

export async function openPublishingBrowser(root: string, storageState?: string): Promise<Browser> {
  const runtimeUrl = pathToFileURL(resolve(root, "automation/browser/runtime.mjs")).href;
  const runtime = await import(runtimeUrl) as {
    browserRuntime(root: string): { libraryBrowserPath: string };
    browserVisibility(root: string): { mode: "headed" | "headless" };
  };
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= runtime.browserRuntime(root).libraryBrowserPath;
  const { chromium } = await import("playwright");
  if (storageState) publishingPath(root, storageState);
  return chromium.launch({ headless: runtime.browserVisibility(root).mode === "headless", timeout: 20_000 });
}

function sameOrigin(page: Page, origin: string) {
  if (new URL(page.url()).origin !== origin) throw new Error("Verify the LinkedIn browser page before continuing.");
}

async function visibleUnique(locator: Locator) {
  await locator.first().waitFor({ state: "visible", timeout });
  if (await locator.count() !== 1) throw new Error("The expected browser control is ambiguous.");
  return locator;
}

export async function openComposer(page: Page, account: Pick<Account, "profileUrl" | "audience">, origin = linkedIn) {
  await page.goto(`${origin}/feed/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  sameOrigin(page, origin);
  const accountName = /^(?:Me|You)$/i;
  const accountMenu = page.getByRole("button", { name: accountName })
    .or(page.getByRole("button").filter({ has: page.getByText(accountName, { exact: true }) })).filter({ visible: true });
  await (await visibleUnique(accountMenu)).click({ timeout });
  const ownProfile = await visibleUnique(page.getByRole("link", { name: /^View profile$/i }).filter({ visible: true }));
  const href = await ownProfile.getAttribute("href");
  const actualProfile = href ? new URL(href, origin) : null;
  if (!actualProfile || (actualProfile.origin + actualProfile.pathname.replace(/\/?$/, "/")).toLowerCase() !== account.profileUrl.toLowerCase()) {
    throw new Error("The browser signed into a different LinkedIn profile.");
  }
  await accountMenu.click({ timeout });
  const label = page.getByText("Start a post", { exact: true });
  const start = page.getByRole("button", { name: "Start a post", exact: true })
    .or(page.getByRole("button").filter({ has: label })).filter({ visible: true });
  await (await visibleUnique(start)).click({ timeout });
  const composer = await visibleUnique(page.getByRole("dialog")
    .filter({ has: page.getByRole("textbox") }).filter({ visible: true }));
  const editor = await visibleUnique(composer.getByRole("textbox").filter({ visible: true }));
  const post = await visibleUnique(composer.getByRole("button", { name: "Post", exact: true }).filter({ visible: true }));
  const verify = async () => {
    sameOrigin(page, origin);
    const audience = composer.getByText(new RegExp(`^(?:Post to )?${account.audience}$`, "i"), { exact: true }).filter({ visible: true });
    if (!(await audience.count())) throw new Error("Verify the saved audience in the LinkedIn composer.");
  };
  await verify();
  if (normalized(await editor.innerText()) || await post.isEnabled()) throw new Error("Preserve the existing LinkedIn composer draft.");
  return { composer, editor, post, verify };
}

function mediaType(name: string) {
  if (/\.mp4$/i.test(name)) return "video/mp4";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.png$/i.test(name)) return "image/png";
  return "image/jpeg";
}

export async function prepareComposer(page: Page, account: Pick<Account, "profileUrl" | "audience">, draft: Draft, media: Media, origin = linkedIn) {
  const { composer, editor, post, verify } = await openComposer(page, account, origin);
  await editor.fill(draft.text, { timeout });
  let attachment: Locator | undefined;
  if (media) {
    const previews = media.kind === "video" ? composer.locator("video, img[src*='videocover']") :
      composer.locator("img[src^='blob:'], img[src*='feedshare'], img[src*='dms/image']:not([src*='profile-displayphoto'])");
    const existing = await previews.count();
    const mediaButton = await visibleUnique(composer.getByRole("button", { name: /^(?:Add )?Media$/i }).filter({ visible: true }));
    const [picker] = await Promise.all([page.waitForEvent("filechooser", { timeout }), mediaButton.click({ timeout })]);
    await picker.setFiles({ name: media.name, mimeType: mediaType(media.name), buffer: media.bytes }, { timeout });
    const next = page.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).filter({ visible: true });
    const afterUpload = await Promise.race([
      previews.nth(existing).waitFor({ state: "visible", timeout }).then(() => "attached"),
      next.first().waitFor({ state: "visible", timeout }).then(() => "editor"),
    ]);
    if (afterUpload === "editor") {
      const editPreview = page.getByRole("dialog").locator(media.kind === "video" ? "video, img[src*='videocover']" : "img[src^='blob:']");
      await editPreview.first().waitFor({ state: "visible", timeout });
      await (await visibleUnique(next)).click({ timeout });
    }
    attachment = previews.nth(existing);
    await attachment.waitFor({ state: "visible", timeout });
  }
  const feedback = "[role='alert'], [role='status'], [aria-live='polite'], [aria-live='assertive']";
  const feedbackChildren = feedback.split(", ").map(selector => `${selector} *`).join(", ");
  const success = page.getByText(/^(?:Post successful|Post published|Your post was shared|Your post has been published)[.!]?$/i, { exact: true })
    .and(page.locator(`${feedback}, ${feedbackChildren}`)).filter({ visible: true });
  const recheck = async () => {
    await verify();
    if (normalized(await editor.innerText()) !== normalized(draft.text) || !(await post.isEnabled()) ||
      (attachment && !(await attachment.isVisible())) || await success.count()) {
      throw new Error("Verify the exact prepared post and a clean confirmation surface.");
    }
  };
  await recheck();
  return {
    recheck,
    click: (remaining: number) => post.click({ timeout: Math.min(remaining, 3000) }),
    async confirm(): Promise<Receipt> {
      await visibleUnique(success);
      sameOrigin(page, origin);
      const href = await success.evaluate((notice, selector) => {
        const region = notice.closest(selector);
        const links = [...(region?.querySelectorAll("a[href]") ?? [])].filter(link => /^View post$/i.test(link.textContent?.trim() ?? ""));
        return links.length === 1 ? links[0].getAttribute("href") : null;
      }, feedback);
      const url = href ? new URL(href, origin).href : undefined;
      return { reference: "linkedin-composer-observed-success", observedAt: new Date().toISOString(), ...(url && postLink(url) ? { url } : {}) };
    },
  };
}

export async function liveComposer(root: string, account: Account) {
  const state = publishingPath(root, account.storageState), browser = await openPublishingBrowser(root, account.storageState);
  try {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}
