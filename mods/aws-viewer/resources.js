// Which aws call loads a folder node's next page, and which parser reads it.
// Pure, so node --test covers it.
import { listBuckets, listObjects, describeParameters } from "./aws-args.js";
import { bucketsPage, objectsPage, parametersPage } from "./parse.js";

export const SERVICES = [
  { id: "s3", kind: "s3", label: "S3" },
  { id: "ssm", kind: "ssm", label: "SSM Parameter Store", path: "" },
];

const LOADERS = {
  s3: { command: (_node, token) => listBuckets(token), parse: (_node, json) => bucketsPage(json) },
  bucket: { command: (node, token) => listObjects(node.bucket, "", token), parse: (node, json) => objectsPage(json, node.bucket, "") },
  prefix: { command: (node, token) => listObjects(node.bucket, node.prefix, token), parse: (node, json) => objectsPage(json, node.bucket, node.prefix) },
  ssm: { command: (node, token) => describeParameters(node.path, token), parse: (node, json) => parametersPage(json, node.path) },
  "ssm-path": { command: (node, token) => describeParameters(node.path, token), parse: (node, json) => parametersPage(json, node.path) },
};

export function isFolder(node) {
  return Boolean(node && LOADERS[node.kind]);
}

/** The aws command (without --profile/--region) for one page; `token` null = first page. */
export function pageCommand(node, token) {
  return loader(node).command(node, token);
}

export function parsePage(node, json) {
  return loader(node).parse(node, json);
}

function loader(node) {
  const found = LOADERS[node?.kind];
  if (!found) throw new Error(`Nothing to load for ${node?.kind ?? "this row"}`);
  return found;
}
