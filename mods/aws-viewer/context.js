// Which profile and region the viewer uses: props first, then the login shell's environment.
// Pure, so node --test covers it.

export const ENV_MARKER = "__AWS_VIEWER_ENV__";

/** Whether the login shell must be asked (props may already name both). */
export function needsShellEnv(props) {
  return !(props?.profile && props?.region);
}

/** Output of the login-shell printf: the marker, then AWS_PROFILE, AWS_REGION, AWS_DEFAULT_REGION. */
export function parseShellEnv(stdout) {
  const lines = String(stdout ?? "").split("\n");
  const start = lines.lastIndexOf(ENV_MARKER);
  if (start < 0) return { profile: "", region: "" };
  const [profile = "", region = "", defaultRegion = ""] = lines.slice(start + 1).map((l) => l.trim());
  return { profile, region: region || defaultRegion };
}

/** { profile, region, profileSource, regionSource }; region "" means the profile's own config. */
export function resolveTarget(props, shellEnv) {
  const profile = String(props?.profile || shellEnv?.profile || "").trim();
  const region = String(props?.region || shellEnv?.region || "").trim();
  return {
    profile, region,
    profileSource: props?.profile ? "props" : shellEnv?.profile ? "AWS_PROFILE" : null,
    regionSource: props?.region ? "props" : shellEnv?.region ? "env" : null,
  };
}
