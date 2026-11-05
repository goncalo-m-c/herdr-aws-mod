// AWS CLI argv builders: read-only list/describe calls, one page per call.
// Pure. `invocation` runs the read-only allowlist before any argv exists.

export const PAGE_SIZE = 50;

const READ_ONLY_COMMANDS = new Set(["s3api list-buckets", "s3api list-objects-v2", "ssm describe-parameters", "iam list-users", "iam list-roles", "iam list-groups", "iam list-policies", "configure get"]);
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
// The CLI reads file:// (and similar) values from disk; a resource name must never do that.
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Thrown instead of building an argv: the allowlist or an unsafe value said no. */
export class Refusal extends Error {}

export function listBuckets(token) {
  return ["s3api", "list-buckets", "--no-paginate", `--max-buckets=${PAGE_SIZE}`, ...tokenArg("--continuation-token", token)];
}

export function listObjects(bucket, prefix, token) {
  return ["s3api", "list-objects-v2", "--no-paginate", flag("--bucket", bucket), ...(prefix ? [flag("--prefix", prefix)] : []),
    "--delimiter=/", `--max-keys=${PAGE_SIZE}`, ...tokenArg("--continuation-token", token)];
}

/** Metadata only: describe-parameters never returns values. `path` "" lists every parameter. */
export function describeParameters(path, token) {
  const filters = path ? [flag("--parameter-filters", JSON.stringify([{ Key: "Path", Option: "Recursive", Values: [path] }]))] : [];
  return ["ssm", "describe-parameters", "--no-paginate", ...filters, `--max-results=${PAGE_SIZE}`, ...tokenArg("--next-token", token)];
}

/** IAM is paged by the CLI: --max-items bounds one call and --starting-token continues (--no-paginate cannot be combined with it). */
export function listUsers(token) { return iamList("list-users", [], token); }
export function listRoles(token) { return iamList("list-roles", [], token); }
export function listGroups(token) { return iamList("list-groups", [], token); }
/** Customer-managed policies only; AWS managed policies are not listed. */
export function listLocalPolicies(token) { return iamList("list-policies", ["--scope=Local"], token); }

function iamList(operation, extra, token) {
  return ["iam", operation, ...extra, `--max-items=${PAGE_SIZE}`, ...tokenArg("--starting-token", token)];
}

/** The `regions` prop as a list of valid region names; throws Refusal on a bad one. Missing means []. */
export function regionList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value.map((r) => String(r).trim()) : [];
  const bad = Array.isArray(value) ? list.find((r) => !REGION.test(r)) : String(value);
  if (bad !== undefined) throw new Refusal(`Refused: "${bad}" is not a valid AWS region name.`);
  return [...new Set(list)];
}

/** Local only: reads the profile's region from ~/.aws/config. */
export function configuredRegion() {
  return ["configure", "get", "region"];
}

/** The full argv for `aws`, with --profile/--region; throws Refusal before anything unsafe. */
export function invocation(command, target) {
  if (!isReadOnly(command)) throw new Refusal(`Refused: "${command.slice(0, 2).join(" ")}" is not a read-only call this viewer allows.`);
  const profile = String(target?.profile ?? "").trim();
  const region = target?.region ? String(target.region).trim() : "";
  if (region && !REGION.test(region)) throw new Refusal(`Refused: "${region}" is not a valid AWS region name.`);
  return [...command, ...(profile ? [`--profile=${profile}`] : []), ...(region ? [`--region=${region}`] : []), "--output=json", "--no-cli-pager", "--no-cli-auto-prompt"];
}

export function isReadOnly(command) {
  const allowed = READ_ONLY_COMMANDS.has(command.slice(0, 2).join(" "));
  return allowed && !command.some((arg) => String(arg).toLowerCase().includes("decryption"));
}

// "--flag=value" keeps values that start with "-" from reading as flags.
function flag(name, value) {
  const text = String(value ?? "");
  if (URL_LIKE.test(text)) throw new Refusal(`Cannot open "${text}": the name looks like a file or URL reference.`);
  return `${name}=${text}`;
}

function tokenArg(name, token) {
  return token ? [flag(name, token)] : [];
}
