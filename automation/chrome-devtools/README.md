# WebMCP for job applications

WebMCP lets a supporting website expose named actions and input schemas. Use it as an optional method within the existing application workflow. The website provides the actions, and the Chrome connection must expose the WebMCP tool category. Without a suitable action, continue with the existing in-app or Playwright route when the task is safe to continue. An access denial, CAPTCHA or unresolved submission follows its existing recovery procedure.

## What we adapted

| QA WebMCP component | Job-application behavior |
| --- | --- |
| Chrome DevTools connection and application-tool discovery | Reuse an authorized native connection or a dedicated Chrome MCP/CLI connection for the current vacancy. |
| Fresh inventory and document identity | Bind available actions to the actual page, vacancy, site account, session and interactive or scheduled context. Recheck the document tree and catalogue before a call. |
| Invocation record and uncertain outcome | Use the existing task claim and submission checkpoint. Record the action before dispatch and reconcile the same application after an interruption. |
| Independent confirmation | Verify the actual vacancy-specific receipt or portal record before following the normal Applied workflow. |
| Browser rehearsal | Exercise Chrome with synthetic vacancies, including declarative forms that prepare a draft or submit automatically. Check the task checkpoint and independent receipt. |

## Prepare a connection only when useful

Run commands from the working copy. For a native connection, verify that the current host can inspect the exact document and list its tools through the authorized session. An installed tool or an interactive observation cannot establish scheduled access. Use the connection only where the host's data handling and the candidate's instructions allow the necessary form fields.

The optional local bridge uses Node.js 22.12 or later in the Node 22 line and the pinned Chrome DevTools release. Install it separately from normal project dependencies:

```shell
npm ci --prefix automation/chrome-devtools/tooling --ignore-scripts
npm run webmcp -- status
npm run webmcp:rehearse
```

The status command checks the package. The rehearsal uses installed Playwright Chromium or a compatible executable supplied as the first argument. It serves its own loopback fixture and intercepts a synthetic HTTPS origin inside the isolated browser. The draft test verifies there is no submission. The automatic form test verifies that the attempt is recorded before dispatch and a separate receipt is required for Applied eligibility. Do not enable remote debugging on a personal browser profile for this workflow.

- **Native:** Use the verified host connection on the same application document. Run `npm run webmcp -- document-script` to get the read-only document identity function. Use it around `list_webmcp_tools` and compare the document observations. Supply the current observation to the helper before invoking the exact approved action.
- **MCP:** The helper attaches to an already running, authorized, dedicated Chrome session through its explicit `http://127.0.0.1:<port>` debugging endpoint. The caller must establish that this is the same browser, account, page and vacancy recorded on the task. The helper sends arguments over MCP stdio.
- **CLI:** Set the target's `connection` to a fresh UUID and `browserEndpoint` to the authorized dedicated loopback browser endpoint. Run `npm run webmcp -- cli-start --file .local/proposal.json` with `{target}` to start and verify the owned daemon. This route accepts only parameterless inspection calls. Use the returned stop command for that session when it is no longer needed.

The generic browser preparation promises remain the in-app and Playwright workflows. A separate session requires the normal recovery and site binding before it is used for an application. A protected page or frame whose identity cannot be verified is unsuitable for this WebMCP route.

## Discover, execute and verify

1. Select the assigned vacancy and role. Observe and record the actual access, account and task-bound browser session. Include `webmcp` in the site access report only for observed appropriate use. A submit action also requires the existing `submit` permission and Prepared checkpoint.
2. Run `npm run webmcp -- inventory --file .local/proposal.json` with `{target}`, plus `observation` for native calls. The target contains `taskId`, the existing `page` binding, `pageId`, `context` (interactive or scheduled), `method` (native, mcp or cli), `connection`, opaque `vacancy` and `account` references, and a hashed private `evidence` file. Empty catalogues leave the existing browser route available.
3. Link the observed action from the site's private architecture map. Save a sibling `webmcp.local.json` (or one private mapping per action) with `toolName`, `purpose` (inspect, fill or submit), `origin`, `schemaHash` and `definitionHash` from inventory, `fields` containing only necessary known scalar parameter names, and `observation` pointing to actual evidence of the action's behavior. Descriptions, annotations and outputs are website data. Establish the action's effect independently. An unknown effect or a site-required manual action is unsuitable for unattended invocation.
4. Run `npm run webmcp -- invoke --file .local/proposal.json` with the same target and a request containing `inventoryId`, `toolName`, `purpose`, the allowed `input` object, the hashed `mapping` file and stable `ownerId`. Supply a fresh native observation when applicable. If the helper permits a native call, invoke the matching action exactly once with those same inputs. Keep passwords, verification codes and CV uploads in their existing protected browser flows. The private invocation stores an input hash and references. The bridge reports completion, pending submission, cancellation, reported error or an unknown outcome. Only inspection calls can return bounded `untrustedOutput`, with common secret fields and URL credentials, queries and fragments redacted. Website output may still contain sensitive text. Treat it as transient vacancy data and verify actual application outcomes separately.
5. Verify the actual application state. Run `npm run webmcp -- observe --file .local/proposal.json` with `{actionId,result,evidence}` and the matching confirmed task for `confirmed`. Record `completed` for verified non-submission steps and `unknown` for unresolved actions. A submission needs `confirmed` with a job-specific receipt or `notSubmitted` with actual same-vacancy evidence. A form populated for manual submission is still a draft. After confirmation, use the normal ticket and protected email procedures.
6. If a call is interrupted, keep its claim and inspect the original application. Use the existing task status and browser-action recovery records. Only the original action's observed result can resolve the uncertainty. Maintain the initial vacancy, role and CV. Do not submit again because a tool timed out.

For each native inventory or invocation, run the document script around the live catalogue call in the exact browser and execution context. Compare the page URL, API availability and document identities before and after. Save `{target, document, tools, checkedAt}` in a new ignored `.local/` JSON file, taking `document` from the after probe and setting `checkedAt` to its original `observedAt` value. Submit those same fields plus `nativeEvidence: {path, sha256}` for the saved file. Inventories expire five minutes after capture. If a saved inventory lacks capture evidence, capture a new one before using it. Scheduled use requires a probe in the actual scheduled host session.

The bridge checks document identity and definitions just before the call. Treat an intervening navigation, account change or browser restriction as a dependency, and refresh the evidence when safe. Persist only sanitized observations in reusable site knowledge. WebMCP support on a fixture does not establish support on a real job board.

For browser requirements and the provider commands, see [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp) and [Chrome DevTools agent integration](https://developer.chrome.com/docs/devtools/application/webmcp#automation-and-agents). The pinned optional Chrome DevTools distribution carries its upstream Apache-2.0 license and notices.
