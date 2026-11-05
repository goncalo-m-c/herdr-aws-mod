// Which aws call loads a folder node's next page, and which parser reads it.
// Pure, so node --test covers it.
import { listBuckets, listObjects, describeParameters, listUsers, listRoles, listGroups, listLocalPolicies, listSecrets, listFunctions, describeRepositories, describeImages, describeInstances, describeFileSystems } from "./aws-args.js";
import { bucketsPage, objectsPage, parametersPage, usersPage, rolesPage, groupsPage, policiesPage, secretsPage, functionsPage, repositoriesPage, imagesPage, instancesPage, fileSystemsPage } from "./parse.js";

// `regional: true` services get one group per listed region; the rest (global, like S3) show once.
export const SERVICES = [
  { id: "s3", kind: "s3", label: "S3" },
  // IAM is global: shown once, with fixed folders (no call) that each list one kind of IAM resource.
  { id: "iam", kind: "iam", label: "IAM", folders: [
    { kind: "iam-users", label: "Users" }, { kind: "iam-roles", label: "Roles" },
    { kind: "iam-groups", label: "Groups" }, { kind: "iam-policies", label: "Policies (local)" },
  ] },
  { id: "secrets", kind: "secrets", label: "Secrets Manager", regional: true },
  { id: "lambda", kind: "lambda", label: "Lambda", regional: true },
  { id: "ecr", kind: "ecr", label: "ECR", regional: true },
  { id: "ec2", kind: "ec2", label: "EC2", regional: true },
  { id: "efs", kind: "efs", label: "EFS", regional: true },
  { id: "ssm", kind: "ssm", label: "SSM Parameter Store", path: "", regional: true },
];

const LOADERS = {
  s3: { command: (_node, token) => listBuckets(token), parse: (_node, json) => bucketsPage(json) },
  bucket: { command: (node, token) => listObjects(node.bucket, "", token), parse: (node, json) => objectsPage(json, node.bucket, "") },
  prefix: { command: (node, token) => listObjects(node.bucket, node.prefix, token), parse: (node, json) => objectsPage(json, node.bucket, node.prefix) },
  "iam-users": { command: (_node, token) => listUsers(token), parse: (_node, json) => usersPage(json) },
  "iam-roles": { command: (_node, token) => listRoles(token), parse: (_node, json) => rolesPage(json) },
  "iam-groups": { command: (_node, token) => listGroups(token), parse: (_node, json) => groupsPage(json) },
  "iam-policies": { command: (_node, token) => listLocalPolicies(token), parse: (_node, json) => policiesPage(json) },
  secrets: { command: (_node, token) => listSecrets(token), parse: (_node, json) => secretsPage(json) },
  lambda: { command: (_node, token) => listFunctions(token), parse: (_node, json) => functionsPage(json) },
  ecr: { command: (_node, token) => describeRepositories(token), parse: (_node, json) => repositoriesPage(json) },
  "ecr-repo": { command: (node, token) => describeImages(node.repository, token), parse: (node, json) => imagesPage(json, node.repository) },
  ec2: { command: (_node, token) => describeInstances(token), parse: (_node, json) => instancesPage(json) },
  efs: { command: (_node, token) => describeFileSystems(token), parse: (_node, json) => fileSystemsPage(json) },
  ssm: { command: (node, token) => describeParameters(node.path, token), parse: (node, json) => parametersPage(json, node.path) },
  "ssm-path": { command: (node, token) => describeParameters(node.path, token), parse: (node, json) => parametersPage(json, node.path) },
};

export function isFolder(node) {
  return Boolean(node && (LOADERS[node.kind] || isGroupNode(node)));
}

/** Folders that only hold other folders and make no aws call: region groups and the IAM root. */
export function isGroupNode(node) {
  return node?.kind === "regions" || node?.kind === "iam";
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
