// Reads AWS_PROFILE and the region from the login shell: Herdr's own environment may lack them.
// A fixed script with no resource names in it; values come back on stdout after a marker.
import { exec } from "herdr";
import { ENV_MARKER, parseShellEnv } from "./context.js";

// Plain "$VAR" reads, so fish, zsh, bash and sh all accept it.
const SCRIPT = `printf '%s\\n%s\\n%s\\n%s\\n' ${ENV_MARKER} "$AWS_PROFILE" "$AWS_REGION" "$AWS_DEFAULT_REGION"`;

export async function loginShellEnv() {
  const r = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" -lc "$1"', "aws-viewer", SCRIPT]).catch(() => null);
  return parseShellEnv(r?.code === 0 ? r.stdout : "");
}
