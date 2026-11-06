# Notification-only attention run

Use the exact private working root selected for this reminder schedule. Read AGENTS.md and automation/attention/README.md. Verify the distinct saved attention preference and actual scheduled capability; never infer authorization from application check-in settings.

Run attention delivery-prepare. On quiet, say nothing and leave task files unchanged. On inspectDelivery, inspect the same native delivery metadata/receipt before observing its real outcome; do not blindly retry. On prepared, retain the returned ID and summary, call delivery-authorize immediately before one supported native host dispatch, and dispatch only if it returns dispatch:true. Use the ID as host idempotency key where supported. Record the actual delivery outcome/reference with delivery-observe; unknown stays unresolved. Report only a new concrete delivery failure or required user action, without repeating unchanged failures.

Use one summary, at most one preview and Review next / Browse waiting tasks / Remind me later. The summary does not ask all recorded task questions. Respect whole-queue snooze, pause and shared conversational focus.

This run reads dedicated minimal attention metadata and, if needed, To Do filenames only. Do not enumerate/read/hash/stat Blocked or other inactive task folders, inspect candidate context or full task-control mirrors, open browsers, poll inboxes, claim/execute/requeue applications, change check-in settings, send email or use another notification transport. A reminder response never clears a blocker. A later actual explicit Review request can authorize selected-task review under the attention procedure.
