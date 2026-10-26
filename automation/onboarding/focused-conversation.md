# One focused step at a time

The agent guides onboarding through one missing decision at a time. A reply can contain any number of additional answers; save every clear, relevant answer before choosing the next question. The user never needs to prepare the command inputs below or edit context files.

## Begin with the applicable roadmap

Read existing context and preparation first. Reuse supplied answers, CVs, mailbox selections and browser preferences. Show the short applicable roadmap once and record `roadmap-shown` after displaying it. Profile-only setup has its smaller scope. A resumed session gets a brief remaining-work summary; show the full roadmap again only when requested or when the scope materially changes.

The seven stages remain organizational groups. Scope, primary boards and default browser are separate decisions within the first stage. Each role's CV request is a focused substep. Provider selection, account selection and authentication are separate email substeps. All subflows share the same conversation checkpoint.

## Ask one independent decision

Before each question, read the latest reply and canonical context. Ask only about something missing, ambiguous or explicitly being revised. Present one question/card in the harness, with short choices when helpful. Do not disguise a questionnaire as one long sentence or one tool call containing several questions. Details needed to express one value, such as salary amount, currency and pay period, can stay together when easy to answer.

Example: “Which work arrangement should I target?” can offer Remote, Hybrid or Onsite. Employment type, minimum pay and notice period are later decisions unless already volunteered. Explain an unusual requested fact briefly. Do not infer legal work authorization, consent, preferences or sensitive answers from geography, silence or a CV.

The agent interprets natural language. The helpers validate bindings, focus and persistence; they do not contain a general language parser or prove that an interpretation is correct. Review each proposed update against the actual user reply/CV, including its role and conditions.

## Capture the whole reply

1. Identify the current answer, extra clear answers, explicit corrections and remaining ambiguities. An extra answer can belong to a later stage. Keep each role's scope; apply an answer to multiple roles only when the user said it applies to them.
2. Read affected canonical files and their current hashes. Prepare only the intended edits, preserving unrelated content. Role IDs and paths must match `role-routing.local.md`. Never copy one role's CV, qualifications or preferences to another by default.
3. Use the existing semantic utilities for browser choice, operating settings, email/provider selection and account binding. A chosen account is not authenticated access, and a supplied interval does not activate scheduling. Reference the actual saved settings afterward. Passwords, API keys, OTPs and tokens use the existing secure/local credential flow, never a response proposal or progress field.
4. Commit canonical Markdown proposals and/or verified settings references using `reply`. Read back the changed fields and verify their meaning. Only then is the corresponding decision resolved. Briefly acknowledge what was saved and ask only the next relevant missing question.
5. If the reply answered later questions but omitted the current one, save the extra answers and keep the current focus. If the current answer needs clarification, use `clarify` for that same decision. Preserve its original prompt and actual clarification/presentation references. Do not repeat the complete original group of questions.

An already supplied fact outside the response helper can be reconciled using its actual canonical reference and original source; do not ask the user again merely to populate conversation metadata. An old file hash becoming historical does not mean its field was never supplied: inspect current content before re-asking. Explicit corrections append answer-reference history and invalidate only affected preparation. Keep the original CV unchanged.

## Shared checkpoint and agent commands

Progress remains schema 3, with an optional version-1 `conversation` checkpoint. Loading an older schema-3 file adds an empty checkpoint without changing its phase, questions or evidence. Schema-1/2 migration retains its existing readiness-revalidation behavior. Candidate facts stay in canonical private files; the checkpoint stores decisions, one active question, source/file references, clarification history and pause state.

```shell
npm run onboarding:conversation -- status
npm run onboarding:conversation -- roadmap-shown
npm run onboarding:conversation -- queue --file .local/questions.json
npm run onboarding:conversation -- next
npm run onboarding:conversation -- asked --id QUESTION_ID --source ACTUAL_PROMPT_REFERENCE
npm run onboarding:conversation -- not-shown --id QUESTION_ID --source ACTUAL_NON_PRESENTATION_OBSERVATION
npm run onboarding:conversation -- reply --file .local/response.json
npm run onboarding:conversation -- clarify --file .local/clarification.json
npm run onboarding:conversation -- pause --source ACTUAL_USER_REQUEST
npm run onboarding:conversation -- resume --source ACTUAL_USER_REQUEST
npm run onboarding:conversation -- defer --id OPTIONAL_QUESTION --source ACTUAL_USER_REQUEST
npm run onboarding:conversation -- recover
npm run onboarding:conversation -- reconcile --file .local/reconciled-response.json --source ACTUAL_CONFLICT_REVIEW
```

`queue` takes metadata objects with `id`, `step`, `substep`, `roleId` (or null for a global choice), `contextPath`, `field`, `prompt` and `required`. Use stable, descriptive IDs and one field/decision per question. Register only relevant gaps, in their intended order. Existing legacy pending questions remain intact; map their actual ID/binding when adopting them. Their original object is retained. Do not clear unknown legacy records just to claim completion.

`next` selects at most one active question. `present` means the host should display that one prompt; call `asked` only after actual presentation. An already presented question returns `wait`. Selection is saved before presentation. If that handoff was interrupted and has no acknowledgement, `next` returns `verifyPresentation`: inspect the actual harness conversation/tool outcome. Record an existing visible prompt with `asked`; only an actual not-shown observation permits `not-shown` and retry of the same question. Unknown presentation stays unresolved. Never assume silence means the question was not displayed. `next --repeat-on-request` re-presents the same focus only when the user requests repetition or interactive resumption. Never use it to resend an unanswered scheduled prompt. `clarify` takes `{id, prompt, sourceReference}` for the actual ambiguous reply; it keeps the original decision and prior prompt history.

`reply` accepts a private version-1 response bundle: `id`, `sourceReference`, `observedAt`, `answers`, `writes` and `references`. Each answer has a `decision` binding (`id`, `step`, `substep`, `roleId`, `contextPath`, `field`) and `kind: answer` or `correction`. Each Markdown write has `path`, `expectedSha256` (null only for a new file) and the proposed complete `content` with unrelated information preserved. Each existing semantic setting is a `{path, sha256}` reference instead of a write. Multiple fields in one file share one file proposal. The input file is generated privately by the agent, not supplied as a questionnaire to the user.

The store checks the whole bundle before writing, then retains an ignored `.local/onboarding-pending-response.json` until all canonical saves and progress references succeed. After an interruption, `next` returns `recoverResponse`. Run `recover` for the same response; exact already-written output is reused, while conflicting edits stop recovery for reconciliation. Do not ask the user to repeat their response or overwrite newer context. For a genuine newer-file conflict, prepare a merged proposal that keeps the same response ID, source, answer bindings and unconflicted/already-saved writes. Use `reconcile` with the actual comparison reference, then `recover`. It revision-checks the replacement journal and refuses a different reply or an unexplained rewrite of unconflicted work. Read back the merged fields; keep newer unrelated information. Once successful, the store removes its temporary journal and keeps only response/answer references and a proposal digest. Remove agent-generated input proposals after successful reconciliation; retain failed proposals privately until resolved. These controls serialize supported conversation writes; arbitrary raw file edits still require the existing one-writer discipline.

## Progress, pauses and completion

For an explicit request to continue, use `npm run onboarding:resume -- --source ACTUAL_REQUEST_REFERENCE`. It resumes pause state when applicable and returns the pending prompt, retained-response recovery or a concrete unfinished stage/substep. When no question is queued, `next` returns the preparation gap. Perform agent-owned work, save its checkpoint and continue until a question, dependency or completed handoff requires yielding. Ordinary scheduled `next` keeps quiet-wait behavior. For later changes, follow [settings](settings.md); `revise` retains the prior question and saved answers while reopening just that decision.

Use the brief conversation summary during normal onboarding. It shows the current stage/substep and saved decisions without presenting every preparation checklist again. Saved decisions and verified capabilities remain separate. Detailed `onboarding:status` is available for inspection; do not paste its full output after every answer.

An explicit pause retains focus and answers. `next` returns `paused`; scheduled runs leave unchanged onboarding quiet. Extra answers volunteered while paused can be saved without resuming questions. An explicit resume restores the same checkpoint, rather than restarting setup. Optional deferrals need the actual user instruction; required unanswered decisions cannot be silently skipped. No application-board folder is created for setup questions.

Pausing onboarding neither disables an existing schedule nor cancels unrelated authorized applications. Independent work can proceed only with its own required setup intact. Later account, MFA or CAPTCHA steps preserve the onboarding focus and use their existing human handoff procedures.

Completion still requires actual readiness and a scoped handoff. A staged/failed response, unresolved required question or paused/active interview cannot be waved away with a green counter. This conversation improvement adds no application approval gates and performs no live applications, inbox mutations or schedule activation.

The staged structure and visible progress adapt [W3C multi-page form guidance](https://www.w3.org/WAI/tutorials/forms/multi-page/) to conversation; one focused question per turn is this workflow's interaction rule.

## Settings focus

Follow [the interactive settings procedure](../settings/README.md) for **Open settings**. Present its native choices or numbered chat menu, keeping one interactive focus. The menu does not replace onboarding's pending question or pause state. A menu save uses the same response bundles and can record clear additional answers; closing it preserves the earlier onboarding checkpoint. Use ordinary settings navigation for its clarification/current-value display rather than opening a second onboarding interview.
