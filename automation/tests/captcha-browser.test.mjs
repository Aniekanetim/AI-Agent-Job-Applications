import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { browserRuntime } from '../browser/runtime.mjs';
import { inspectHcaptcha, assertCaptchaInspection } from '../../.local/check/automation/browser/captcha-inspection.js';
import { pauseForCaptcha, recordCaptchaRequest, captchaNextAction, resolveCaptcha } from '../../.local/check/automation/browser/captcha.js';
import { markSubmissionAttempted, canMarkApplied } from '../../.local/check/automation/workflow/application-state.js';

test('isolated browser rehearsal detects the widget, waits unattended, resumes after simulated human action and submits once', { timeout: 90_000 }, async () => {
  // Ordinary local controls simulate human handoff. No CAPTCHA service, account, candidate or employer receives data.
  let submissions = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/widget') return res.end(`<input id="human" type="checkbox" aria-label="I am human" disabled>
      <button onclick="document.getElementById('human').checked=true">Simulate human completion (fixture only)</button>
      <button onclick="document.getElementById('human').checked=false">Expire fixture challenge</button>`);
    if (req.method === 'POST' && req.url === '/submit') { submissions++; return res.end('<h1>Application received: synthetic-1</h1>'); }
    res.end(`<h1>Synthetic application</h1><form method="post" action="/submit">
      <label>First name<input name="first" required></label><label>CV<input type="file" name="cv" required></label>
      <iframe title="Widget containing checkbox for hCaptcha security challenge" src="/widget"></iframe>
      <button>Submit fixture application</button></form>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(), origin = `http://127.0.0.1:${address.port}`;
  const runtime = browserRuntime();
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = runtime.libraryBrowserPath;
  let browser;
  try {
    const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(origin);
    await page.getByLabel('First name').fill('Synthetic');
    await page.getByLabel('CV').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic fixture only') });
    const frame = page.frameLocator('iframe');
    await frame.getByRole('checkbox').waitFor();
    assert.deepEqual(await inspectHcaptcha(page), { state: 'humanRequired', provider: 'hcaptcha' });
    const now = '2026-10-26T08:00:00Z', later = '2026-10-26T08:05:00Z';
    const jobUrl = 'https://fixture.example.invalid/jobs/1';
    const task = { taskId: 'APP-browser-fixture', originalIntake: 'To Do', selectedRoleId: 'fixture',
      cvVersion: 'fixture-1', cvSha256: 'a'.repeat(64), checkpoint: 'prepared',
      browserExecution: { defaultBrowser: 'playwright', activeBrowser: 'playwright', requiresFileUpload: true, handoffs: [] } };
    const paused = recordCaptchaRequest(pauseForCaptcha(task, { handoffId: 'fixture-challenge', jobUrl,
      sessionReference: 'fixture-session', sessionAccess: 'visible', draftReference: null,
      checkpointReference: '.local/fixture-checkpoint.md', evidenceReference: '.local/fixture-captcha.md',
      accessContextPath: 'fixture-site-map.local.md', lastCompletedStep: 'Synthetic form ready', observedAt: now }),
      'fixture-challenge', 'fixture-ticket-comment', now);
    const restarted = JSON.parse(JSON.stringify(paused));
    assert.equal(captchaNextAction(restarted), 'wait');
    assert.throws(() => markSubmissionAttempted(restarted)); assert.equal(submissions, 0);
    assert.throws(() => assertCaptchaInspection({ state: 'notObserved', provider: null }, true));
    // This click is a test-fixture event standing in for a person, never a real CAPTCHA operation.
    await frame.getByRole('button', { name: 'Simulate human completion (fixture only)' }).click();
    assert.equal((await inspectHcaptcha(page)).state, 'cleared');
    const resumed = resolveCaptcha(restarted, { handoffId: 'fixture-challenge', taskId: task.taskId, jobUrl,
      browser: 'playwright', sessionReference: 'fixture-session', sameVacancyVerified: true, sessionVerified: true,
      observedAt: later, evidenceReference: '.local/fixture-recheck.md', submissionEvidenceReference: '.local/fixture-not-submitted.md',
      outcome: 'notSubmitted', humanCompletionReference: 'fixture-event', challengeCleared: true,
      sessionVisible: true, fieldsReviewed: true, cvChecked: true, recovery: 'sameSession', draftReference: null });
    assert.equal(await page.getByLabel('First name').inputValue(), 'Synthetic');
    assert.equal(await page.getByLabel('CV').evaluate(input => input.files[0].name), 'synthetic.txt');
    // A later expiry invalidates a previously cleared observation; re-inspect before the final action.
    await frame.getByRole('button', { name: 'Expire fixture challenge' }).click();
    const expired = await inspectHcaptcha(page); assert.equal(expired.state, 'humanRequired');
    assert.throws(() => assertCaptchaInspection(expired, true)); assert.equal(submissions, 0);
    const expiredTask = pauseForCaptcha(resumed, { handoffId: 'fixture-challenge-2', jobUrl,
      sessionReference: 'fixture-session', sessionAccess: 'visible', draftReference: null,
      checkpointReference: '.local/fixture-expired.md', evidenceReference: '.local/fixture-expiry.md',
      accessContextPath: 'fixture-site-map.local.md', lastCompletedStep: 'Rechecked before submit', observedAt: later });
    assert.throws(() => markSubmissionAttempted({ ...expiredTask, checkpoint: 'prepared' }));
    await frame.getByRole('button', { name: 'Simulate human completion (fixture only)' }).click();
    assertCaptchaInspection(await inspectHcaptcha(page), true);
    const resumedAgain = resolveCaptcha(expiredTask, { ...resumed.captchaHandoffs[0].resolution,
      handoffId: 'fixture-challenge-2', taskId: task.taskId, jobUrl, browser: 'playwright',
      sameVacancyVerified: true, sessionVerified: true, outcome: 'notSubmitted',
      humanCompletionReference: 'fixture-second-human-event', challengeCleared: true,
      sessionVisible: true, fieldsReviewed: true, cvChecked: true, recovery: 'sameSession', draftReference: null });
    assert.equal(resumedAgain.captchaHandoffs.length, 2);
    const attempted = markSubmissionAttempted({ ...resumedAgain, checkpoint: 'prepared' });
    await page.getByRole('button', { name: 'Submit fixture application' }).click();
    await page.getByRole('heading', { name: 'Application received: synthetic-1' }).waitFor();
    const confirmed = { ...attempted, checkpoint: 'confirmed', confirmation: { reference: 'synthetic-1', observedAt: later } };
    assert.equal(canMarkApplied(confirmed), true); assert.equal(submissions, 1);
    assert.throws(() => markSubmissionAttempted(attempted)); assert.throws(() => markSubmissionAttempted(confirmed));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = previous;
  }
});
