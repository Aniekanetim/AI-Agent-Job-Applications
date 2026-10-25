import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { workingRoot } from './runtime.mjs';

/** Local-only synthetic draft: no CV, account, real application or external destination. */
export async function createRehearsal(folder) {
  mkdirSync(folder, { recursive: true });
  const applicationId = `rehearsal-${randomUUID().slice(0, 12)}`;
  const uploadPath = resolve(folder, 'synthetic-upload.txt');
  const uploadMarker = `Synthetic upload for ${applicationId}`;
  writeFileSync(uploadPath, uploadMarker, { mode: 0o600 });
  let saved = false;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', path === '/' ? 'text/html; charset=utf-8' : 'application/json');
    if (request.method === 'GET' && path === '/draft') {
      response.end(JSON.stringify({ applicationId, name: saved ? 'Synthetic Candidate' : '', saved })); return;
    }
    if (request.method === 'POST' && path === '/draft') {
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 1024) throw new Error(); }
        const data = JSON.parse(body);
        if (data.name !== 'Synthetic Candidate' || data.applicationId !== applicationId) throw new Error();
        saved = true; response.end(JSON.stringify({ applicationId, saved }));
      } catch { response.statusCode = 400; response.end('{"saved":false}'); }
      return;
    }
    if (request.method !== 'GET' || path !== '/') { response.statusCode = 404; response.end('{}'); return; }
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Application browser rehearsal</title>
      <h1>Application browser rehearsal</h1><p>Local synthetic data only. No job application is submitted.</p>
      <p id="application-id">${applicationId}</p>
      <label>Candidate name <input id="name" value="${saved ? 'Synthetic Candidate' : ''}"></label>
      <button id="save">Save rehearsal checkpoint</button><output id="checkpoint">${saved ? 'Checkpoint restored' : 'Not saved'}</output>
      <label>Test document <input id="document" type="file" accept=".txt"></label><output id="upload">No file</output>
      <button id="check-form">Check form</button><output id="form-outcome" aria-live="polite">Waiting</output>
      <button id="check">Check browser</button><output id="outcome" aria-live="polite">Waiting</output>
      <script>
      const applicationId=${JSON.stringify(applicationId)}; let uploadVerified=false;
      document.querySelector('#save').onclick=async()=>{
        const result=await fetch('/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({applicationId,name:document.querySelector('#name').value})});
        document.querySelector('#checkpoint').textContent=result.ok?'Checkpoint saved':'Use the synthetic candidate name';
      };
      document.querySelector('#document').onchange=async event=>{
        const file=event.target.files[0]; uploadVerified=!!file && await file.text()===${JSON.stringify(uploadMarker)};
        document.querySelector('#upload').textContent=uploadVerified?'Synthetic file upload verified':'File content not verified';
      };
      document.querySelector('#check-form').onclick=async()=>{
        const draft=await(await fetch('/draft')).json();
        document.querySelector('#form-outcome').textContent=draft.applicationId===applicationId&&draft.saved&&document.querySelector('#name').value==='Synthetic Candidate'?'Form interaction verified: '+applicationId:'Rehearsal incomplete';
      };
      document.querySelector('#check').onclick=async()=>{
        const draft=await(await fetch('/draft')).json();
        document.querySelector('#outcome').textContent=draft.applicationId===applicationId&&draft.saved&&document.querySelector('#name').value==='Synthetic Candidate'&&uploadVerified?'Browser interaction and upload verified: '+applicationId:'Rehearsal incomplete';
      };
      </script></html>`);
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  return { applicationId, uploadPath, url: `http://127.0.0.1:${address.port}/?application=${applicationId}`,
    close: () => new Promise(done => server.close(done)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const session = await createRehearsal(resolve(workingRoot, 'output/playwright', `host-rehearsal-${randomUUID().slice(0, 8)}`));
  console.log(JSON.stringify({ ...session, close: undefined, instructions: 'Use Synthetic Candidate. Save the checkpoint, resume the same URL in the upload fallback, select only the synthetic file and inspect the outcome. Send close on stdin to stop.' }, null, 2));
  const timeout = setTimeout(async () => { await session.close(); process.exit(0); }, 900_000);
  process.stdin.on('data', async chunk => { if (chunk.toString().trim() === 'close') { clearTimeout(timeout); await session.close(); process.exit(0); } });
}
