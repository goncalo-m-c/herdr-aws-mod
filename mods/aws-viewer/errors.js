// Short, actionable messages for failed aws calls (expired login, access denied, missing CLI).
// Pure, so node --test covers it.

const MAX_LENGTH = 240;

const RULES = [
  [/token has expired|sso session .*expired|expiredtoken|token .*is expired|error loading sso token|refresh.*token.*(failed|expired)/i,
    (profile) => `Credentials for ${profile} expired. Log in again (aws sso login or tsh), then refresh.`],
  [/unable to locate credentials|nocredentials/i,
    (profile) => `No credentials for ${profile}. Log in (aws sso login or tsh), then refresh.`],
  [/config profile \(.*\) could not be found/i,
    (profile) => `Profile ${profile} is not in your AWS config.`],
  [/credential_process|error when retrieving credentials from custom-process/i,
    (profile) => `The credential helper for ${profile} failed. Log in with tsh or aws sso login, then refresh.`],
  [/accessdenied|not authorized|unauthorizedoperation|\(403\)|forbidden/i,
    () => "Access denied: your role cannot list this resource."],
  [/nosuchbucket/i, () => "This bucket no longer exists."],
  [/could not connect to the endpoint|endpointconnectionerror|connect timeout|read timeout/i,
    () => "Cannot reach AWS. Check the network or VPN, then refresh."],
];

/** `stderr` from a non-zero aws exit. */
export function describeAwsError(stderr, profile) {
  const text = String(stderr ?? "").trim();
  const rule = RULES.find(([pattern]) => pattern.test(text));
  return rule ? rule[1](profile || "this profile") : firstLine(text) || "The aws command failed with no message.";
}

const NOT_SET = /NotFoundError|NoSuchPublicAccessBlockConfiguration/;
const NO_ACCESS = /AccessDenied/;

/** One details field failed: `message` is what describeAwsError made, `stderr` the raw aws text (codes live there). Shown in that row only. */
export function describeFieldError(message, stderr = message) {
  if (NOT_SET.test(stderr)) return "Not set";
  if (NO_ACCESS.test(stderr)) return "No access";
  return message;
}

/** exec rejected: the program could not start. */
export function describeExecFailure(error) {
  const text = String(error?.message ?? error ?? "");
  if (/not found|no such file|enoent|cannot start|failed to start|spawn/i.test(text)) {
    return "The aws CLI was not found. Install AWS CLI v2 and make sure it is on your login PATH.";
  }
  return firstLine(text) || "The aws command could not run.";
}

function firstLine(text) {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const clean = line.replace(/^aws:\s*\[error\]:\s*/i, "");
  return clean.length > MAX_LENGTH ? `${clean.slice(0, MAX_LENGTH - 1)}…` : clean;
}
