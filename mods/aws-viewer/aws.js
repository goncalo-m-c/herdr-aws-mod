// The only place that runs `aws`. invocation() guards every call before exec sees it.
// Output stays in memory: nothing is logged or written to disk.
import { exec } from "herdr";
import { invocation, configuredRegion } from "./aws-args.js";
import { describeAwsError, describeExecFailure } from "./errors.js";

/** Runs one read-only page call and returns its parsed JSON. Throws with a short message. */
export async function runAws(command, target) {
  const stdout = await runGuarded(command, target);
  try { return JSON.parse(stdout || "{}"); }
  catch { throw new Error("The aws CLI returned output this viewer cannot read."); }
}

/** The profile's region from ~/.aws/config (a local read). "" means none is set; a failed lookup throws. */
export async function profileRegion(target) {
  const result = await execAws(configuredRegion(), target);
  // `configure get` exits 1 with no output when the key is unset.
  if (result.code !== 0 && !String(result.stderr ?? "").trim()) return "";
  return checked(result, target).trim();
}

async function runGuarded(command, target) {
  return checked(await execAws(command, target), target);
}

async function execAws(command, target) {
  return exec("aws", invocation(command, target)).catch((e) => { throw new Error(describeExecFailure(e)); });
}

function checked(result, target) {
  if (result.code !== 0) throw Object.assign(new Error(describeAwsError(result.stderr, target.profile)), { stderr: result.stderr });
  return result.stdout;
}
