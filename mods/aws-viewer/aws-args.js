// AWS CLI argv builders: read-only list/describe calls, one page per call.
// Pure. `invocation` runs the read-only allowlist before any argv exists.

export const PAGE_SIZE = 50;

const READ_ONLY_COMMANDS = new Set(["s3api list-buckets", "s3api list-objects-v2", "ssm describe-parameters", "configure get"]);
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
