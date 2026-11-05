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

/** The profile's region from ~/.aws/config (a local read), or "" when unset. */
export async function profileRegion(target) {
  try { return (await runGuarded(configuredRegion(), target)).trim(); }
  catch { return ""; }
}

async function runGuarded(command, target) {
  const argv = invocation(command, target);
  const result = await exec("aws", argv).catch((e) => { throw new Error(describeExecFailure(e)); });
  if (result.code !== 0) throw new Error(describeAwsError(result.stderr, target.profile));
  return result.stdout;
}
