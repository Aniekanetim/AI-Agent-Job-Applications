# Job-board access and local credentials

Each job board has access instructions and a commented `.env.example`. Users can store their login email and password in an ignored `.env` beside that example. The agent loads those values at runtime for the board's observed browser sign-in flow.

| Board | Public template | Local credential variables |
| --- | --- | --- |
| LinkedIn | [LinkedIn/.env.example](LinkedIn/.env.example) | `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD` |
| Indeed | [Indeed/.env.example](Indeed/.env.example) | `INDEED_EMAIL`, `INDEED_PASSWORD` |
| Glassdoor | [Glassdoor/.env.example](Glassdoor/.env.example) | `GLASSDOOR_EMAIL`, `GLASSDOOR_PASSWORD` |
| CryptoJobsList | [CryptoJobsList/.env.example](CryptoJobsList/.env.example) | `CRYPTOJOBSLIST_EMAIL`, `CRYPTOJOBSLIST_PASSWORD` |

During application onboarding, choose one to three primary boards. The agent prepares [browser tooling](../../automation/browser/README.md) before authentication, then records access and initial site mapping as separate [progress checks](../../automation/onboarding/README.md). A populated credential file alone completes neither check. Additional assigned websites can be prepared later.

## Configure a board

1. The agent copies that board's `.env.example` to `.env` if `.env` does not already exist. Preserve an existing file and its values.
2. Enter the account values locally in `.env`, uncommenting the two assignment lines. Keep the public `.env.example` commented and blank. Quoted values preserve spaces and `#` characters; do not execute `.env` as a shell script.
3. In `access-and-instructions.local.md`, record only the `.env` path, variable names, relevant sign-in URL/account reference and any session/MFA instructions. Passwords stay out of Markdown, tickets and chat transcripts.
4. The agent loads only the selected board's file in the authentication process and uses the credentials on the verified matching board login. It does not reuse them on an external employer or ATS login; that destination needs its own explicitly supplied account reference.

These files are plaintext local storage, excluded from Git. A fresh clone carries the commented examples, not the private credentials. A secure credential store or an existing authorized browser session can still be used instead. New boards follow the same example/private-file convention with distinct variable names.

## Load credentials for browser authentication

An environment file is not loaded merely because it exists. A Node authentication runner started at the repository root can read the selected file with the built-in parser available in this project's Node version. Reading the file into a scoped object also avoids accidentally using an inherited login for another account:

```javascript
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const credentials = parseEnv(
  readFileSync("Job Context/Job Boards/LinkedIn/.env", "utf8"),
);

const email = credentials.LINKEDIN_EMAIL;
const password = credentials.LINKEDIN_PASSWORD;

if (!email || !password) {
  throw new Error("LinkedIn login values are not configured.");
}

// Pass these values to the observed LinkedIn sign-in routine at runtime.
// Do not print them or hard-code them in reusable site routines.
```

Use the corresponding file and keys for another board. Browser tools that do not use a Node runner need an equivalent private runtime-loading mechanism. Do not dump environment files or the full process environment to tool output. Keep login credentials out of screenshots, traces and reusable site knowledge.

The included website routines remain unlearned until [discovery](../../Application%20Workflow/discovery-workflow.md) observes the actual flow. Populating `.env` does not establish working access. If the site uses SSO, a magic link, MFA or a challenge, follow its actual access procedure; a password entry does not bypass those steps. Missing or unusable access becomes a specific dependency under the existing workflow.

## Browser-specific access

Respect the saved default browser and prepare Playwright for upload applications. Verify account access in the default and required fallback separately; profiles and cookies are not automatically shared. Keep only secure session/credential references in access instructions. If OTP/MFA is needed, use the selected role's verification-access instructions and resume its existing checkpoint. A tool or platform denial remains a blocker; fallback must not evade it.
