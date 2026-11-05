import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bucketsPage, objectsPage, parametersPage, usersPage, rolesPage, groupsPage, policiesPage, secretsPage, functionsPage, repositoriesPage, imagesPage, instancesPage, fileSystemsPage, clustersPage, clusterDetailsPage, dbInstancesPage, alarmsPage } from "../parse.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

test("buckets page and its continuation token", () => {
  const page = bucketsPage(fixture("list-buckets"));
  assert.deepEqual(page.items.map((i) => i.label), ["my-bucket", "my-other-bucket"]);
  assert.equal(page.items[0].kind, "bucket");
  assert.equal(page.nextToken, "my-other-bucket-token");
  assert.equal(bucketsPage({ Buckets: [] }).nextToken, null);
});

test("objects page: prefixes as folders, objects as leaves, folder marker skipped", () => {
  const page = objectsPage(fixture("list-objects-v2"), "my-bucket", "reports/");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [
    ["prefix", "archive"], ["prefix", "daily"], ["object", "2024-05.csv"],
  ]);
  assert.equal(page.items[0].prefix, "reports/archive/");
  assert.deepEqual(page.items[2].meta, { size: 1536, lastModified: "2024-05-02T09:30:12+00:00", storageClass: "STANDARD_IA", etag: '"9b2cf535f27731c974343645a3985328"' });
  assert.equal(page.nextToken, "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=");
  assert.equal(objectsPage(fixture("list-objects-v2-last"), "my-bucket", "reports/").nextToken, null);
});

test("parameters at the root group by first segment", () => {
  const page = parametersPage(fixture("describe-parameters"), "");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["ssm-path", "app"], ["ssm-path", "other"], ["parameter", "plain-root-param"]]);
  assert.equal(page.items[0].path, "/app");
  assert.equal(page.nextToken, "AAEAAWxxx-next-page-token");
});

test("parameters under a path: folders and leaves, metadata only", () => {
  const page = parametersPage(fixture("describe-parameters"), "/app/dev");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["ssm-path", "db"], ["parameter", "feature-flag"]]);
  const db = parametersPage(fixture("describe-parameters"), "/app/dev/db");
  const password = db.items.find((i) => i.label === "password");
  assert.equal(password.meta.type, "SecureString");
  assert.ok(!("value" in password) && !("Value" in password.meta));
});

test("IAM users page: names, ARN, token", () => {
  const page = usersPage(fixture("iam-list-users"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["iam-user", "alice"], ["iam-user", "bot"]]);
  assert.equal(page.items[0].meta.arn, "arn:aws:iam::123456789012:user/alice");
  assert.equal(page.items[1].meta.passwordLastUsed, null);
  assert.equal(page.nextToken, "example-users-token");
});

test("IAM roles, groups and local policies pages", () => {
  const roles = rolesPage(fixture("iam-list-roles"));
  assert.deepEqual(roles.items.map((i) => i.label), ["app-role", "plain-role"]);
  assert.equal(roles.items[0].meta.maxSessionDuration, 3600);
  assert.equal(roles.nextToken, null);
  assert.equal(groupsPage(fixture("iam-list-groups")).items[0].meta.id, "AGPAEXAMPLEGROUPID01");
  const policy = policiesPage(fixture("iam-list-policies")).items[0];
  assert.deepEqual([policy.kind, policy.label, policy.meta.attachmentCount, policy.meta.defaultVersion], ["iam-policy", "read-reports", 3, "v2"]);
  assert.deepEqual(usersPage({}).items, []);
});

test("secrets page: metadata only, no value fields", () => {
  const page = secretsPage(fixture("list-secrets"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["secret", "app/db"], ["secret", "plain"]]);
  assert.deepEqual(Object.keys(page.items[0].meta), ["arn", "description", "lastChanged", "lastAccessed", "created"]);
  assert.equal(page.items[0].meta.description, "Example database login");
  assert.equal(page.nextToken, "example-secrets-token");
  assert.equal(secretsPage({}).nextToken, null);
});

test("Lambda functions page: name, runtime, memory, last modified, token", () => {
  const page = functionsPage(fixture("lambda-list-functions"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["lambda-function", "report-builder"], ["lambda-function", "image-fn"]]);
  assert.deepEqual([page.items[0].meta.runtime, page.items[0].meta.memory], ["python3.12", 256]);
  assert.equal(page.items[1].meta.runtime, "Image");
  assert.equal(page.nextToken, "example-functions-token");
  assert.equal(functionsPage({}).nextToken, null);
});

test("ECR repositories page: folders with metadata and token", () => {
  const page = repositoriesPage(fixture("ecr-describe-repositories"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label, i.repository]), [["ecr-repo", "team/web", "team/web"], ["ecr-repo", "api", "api"]]);
  assert.equal(page.items[0].meta.uri, "123456789012.dkr.ecr.eu-west-1.amazonaws.com/team/web");
  assert.equal(page.nextToken, "example-repos-token");
  assert.deepEqual(repositoriesPage({}).items, []);
});

test("ECR images page: tags, pushed date, size; untagged images use the digest", () => {
  const page = imagesPage(fixture("ecr-describe-images"), "api");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["ecr-image", "latest, v1.2.0"], ["ecr-image", "sha256:examplediges"]]);
  assert.deepEqual([page.items[0].meta.size, page.items[0].meta.pushed, page.items[1].meta.tags], [52428800, "2024-05-01T08:30:00+00:00", []]);
  assert.notEqual(page.items[0].id, page.items[1].id);
  assert.equal(page.nextToken, "example-images-token");
});

test("EC2 instances page: flattens reservations, keeps only the Name tag, never user data", () => {
  const page = instancesPage(fixture("ec2-describe-instances"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["ec2-instance", "web-1"], ["ec2-instance", "i-0123456789EXAMPLE2"], ["ec2-instance", "worker-1"]]);
  assert.deepEqual(page.items[0].meta, { id: "i-0123456789EXAMPLE1", state: "running", type: "t3.micro", zone: "eu-west-1a", privateIp: "10.0.0.11" });
  assert.ok(!JSON.stringify(page).includes("EXAMPLE-NOT-SHOWN") && !JSON.stringify(page).includes("Env"));
  assert.equal(page.nextToken, "example-instances-token");
  assert.deepEqual(instancesPage({}).items, []);
});

test("EFS file systems page: id, name, size, performance mode, state, token", () => {
  const page = fileSystemsPage(fixture("efs-describe-file-systems"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["efs-filesystem", "shared-data"], ["efs-filesystem", "fs-0123EXAMPLE2"]]);
  assert.deepEqual(page.items[0].meta, { id: "fs-0123EXAMPLE1", size: 6144, performanceMode: "generalPurpose", state: "available" });
  assert.equal(page.nextToken, "example-filesystems-token");
  assert.deepEqual(fileSystemsPage({}).items, []);
});

test("EKS clusters page: names become folders, with a token", () => {
  const page = clustersPage(fixture("eks-list-clusters"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label, i.cluster]), [["eks-cluster", "prod-cluster", "prod-cluster"], ["eks-cluster", "dev-cluster", "dev-cluster"]]);
  assert.equal(page.nextToken, "example-clusters-token");
  assert.deepEqual(clustersPage({}).items, []);
});

test("EKS cluster details page: one leaf with version, status, endpoint, created; no certificate", () => {
  const page = clusterDetailsPage(fixture("eks-describe-cluster"), "prod-cluster");
  assert.equal(page.items.length, 1);
  assert.deepEqual([page.items[0].kind, page.items[0].label], ["eks-details", "v1.30 ACTIVE"]);
  assert.deepEqual(page.items[0].meta, { version: "1.30", status: "ACTIVE", endpoint: "https://EXAMPLE0123456789.gr7.eu-west-1.eks.amazonaws.com", created: "2024-05-01T08:30:00.000000+00:00" });
  assert.ok(!JSON.stringify(page).includes("EXAMPLE-NOT-SHOWN"));
  assert.equal(page.nextToken, null);
  assert.deepEqual(clusterDetailsPage({}, "x").items, []);
});

test("RDS instances page: engine, version, class, status, endpoint; never the master username", () => {
  const page = dbInstancesPage(fixture("rds-describe-db-instances"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["rds-instance", "orders-db"], ["rds-instance", "new-db"]]);
  assert.deepEqual(page.items[0].meta, { engine: "postgres", version: "16.3", class: "db.t3.micro", status: "available", endpoint: "orders-db.EXAMPLE.eu-west-1.rds.amazonaws.com:5432" });
  assert.equal(page.items[1].meta.endpoint, null);
  assert.ok(!JSON.stringify(page).includes("example_admin"));
  assert.equal(page.nextToken, "example-dbinstances-token");
  assert.deepEqual(dbInstancesPage({}).items, []);
});

test("CloudWatch alarms page: state, metric, namespace, threshold, last update", () => {
  const page = alarmsPage(fixture("cloudwatch-describe-alarms"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["cw-alarm", "high-cpu"], ["cw-alarm", "queue-depth"]]);
  assert.deepEqual(page.items[0].meta, { state: "ALARM", metric: "CPUUtilization", namespace: "AWS/EC2", threshold: 80, stateUpdated: "2024-06-01T10:15:00.000000+00:00" });
  assert.equal(page.nextToken, "example-alarms-token");
  assert.deepEqual(alarmsPage({}).items, []);
});
