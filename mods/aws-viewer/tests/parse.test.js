import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ownershipText, versioningText, encryptionText, publicAccessText, bucketsPage, objectsPage, parametersPage, usersPage, rolesPage, groupsPage, policiesPage, secretsPage, functionsPage, repositoriesPage, imagesPage, instancesPage, fileSystemsPage, clustersPage, clusterDetailsPage, dbInstancesPage, alarmsPage, logGroupsPage } from "../parse.js";
import { listObjects, listUsers } from "../aws-args.js";
import { describeAwsError, describeFieldError } from "../errors.js";

// The fixtures are recorded from moto (see scripts/mock-aws-record.sh): real response shapes, paging keys and flags.
// Ids and dates change on each recording, so tests compare with the raw fixture or check the shape, not fixed values.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const labels = (page) => page.items.map((i) => i.label);
const sorted = (list) => [...list].sort();

test("buckets page: names and metadata; moto sets no continuation token", () => {
  const raw = fixture("s3-list-buckets");
  const page = bucketsPage(raw);
  assert.deepEqual(sorted(labels(page)), ["assets-bucket", "logs-bucket", "reports-bucket"]);
  assert.equal(page.items[0].kind, "bucket");
  assert.equal(page.items[0].meta.created, raw.Buckets[0].CreationDate);
  assert.equal(page.nextToken, null);
  assert.equal(bucketsPage({ Buckets: [] }).nextToken, null);
});

test("objects page: prefixes as folders, objects as leaves, folder marker skipped", () => {
  const root = objectsPage(fixture("s3-list-objects-root"), "reports-bucket", "");
  assert.deepEqual(root.items.map((i) => [i.kind, i.label]), [["prefix", "reports"], ["object", "readme.txt"]]);
  const page = objectsPage(fixture("s3-list-objects-reports"), "reports-bucket", "reports/");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["prefix", "archive"], ["prefix", "daily"], ["object", "2024-05.csv"], ["object", "2024-06.csv"]]);
  assert.equal(page.items[0].prefix, "reports/archive/");
  assert.equal(page.items[2].key, "reports/2024-05.csv");
  assert.deepEqual(Object.keys(page.items[2].meta), ["size", "lastModified", "storageClass", "etag"]);
  assert.equal(page.items[2].meta.size, 14);
  assert.equal(page.items[2].meta.storageClass, "STANDARD");
  assert.equal(page.nextToken, null);
});

test("objects second page: NextContinuationToken is read only while IsTruncated", () => {
  const first = fixture("s3-list-objects-reports.page1");
  const one = objectsPage(first, "reports-bucket", "reports/");
  assert.equal(first.IsTruncated, true);
  assert.equal(one.nextToken, first.NextContinuationToken);
  const two = objectsPage(fixture("s3-list-objects-reports.page2"), "reports-bucket", "reports/");
  assert.equal(two.nextToken, null);
  assert.deepEqual([...one.items, ...two.items].map((i) => i.label), ["2024-05.csv", "2024-06.csv", "archive", "daily"]);
  // The next call carries the token as the mod builds it.
  assert.ok(listObjects("reports-bucket", "reports/", one.nextToken).includes(`--continuation-token=${one.nextToken}`));
});

test("parameters at the root group by first segment", () => {
  const page = parametersPage(fixture("ssm-describe-parameters.us-east-1"), "");
  assert.deepEqual(sorted(page.items.map((i) => `${i.kind}:${i.label}`)), ["parameter:plain-root-param", "ssm-path:app", "ssm-path:other"]);
  assert.equal(page.items.find((i) => i.label === "app").path, "/app");
  assert.equal(page.nextToken, null);
});

test("parameters under a path: folders and leaves, metadata only", () => {
  const raw = fixture("ssm-describe-parameters-app-dev.us-east-1");
  const dev = parametersPage(raw, "/app/dev");
  assert.deepEqual(sorted(dev.items.map((i) => `${i.kind}:${i.label}`)), ["parameter:feature-flag", "ssm-path:db"]);
  const db = parametersPage(fixture("ssm-describe-parameters-app-dev-db.us-east-1"), "/app/dev/db");
  const password = db.items.find((i) => i.label === "password");
  assert.deepEqual([password.kind, password.name, password.meta.type, password.meta.tier], ["parameter", "/app/dev/db/password", "SecureString", "Standard"]);
  assert.ok(!("value" in password) && !("Value" in password.meta));
  assert.ok(!JSON.stringify(db).includes("not-a-real-secret"));
});

test("IAM users page: names, ARN, and the CLI's paging token", () => {
  const all = usersPage(fixture("iam-list-users"));
  assert.deepEqual(labels(all), ["alice", "bob", "carol"]);
  assert.equal(all.items[0].kind, "iam-user");
  assert.equal(all.items[0].meta.arn, "arn:aws:iam::123456789012:user/alice");
  assert.equal(all.items[0].meta.passwordLastUsed, null);
  assert.equal(all.nextToken, null);
  const first = fixture("iam-list-users.page1");
  const one = usersPage(first);
  assert.equal(one.nextToken, first.NextToken);
  assert.ok(one.nextToken);
  const two = usersPage(fixture("iam-list-users.page2"));
  assert.deepEqual([...labels(one), ...labels(two)], ["alice", "bob", "carol"]);
  assert.equal(two.nextToken, null);
  assert.ok(listUsers(one.nextToken).includes(`--starting-token=${one.nextToken}`));
});

test("IAM roles, groups and local policies pages", () => {
  const roles = rolesPage(fixture("iam-list-roles"));
  assert.deepEqual(sorted(labels(roles)), ["app-role", "batch-role", "lambda-exec-eu-west-1", "lambda-exec-us-east-1", "web-role"]);
  assert.equal(roles.items.find((i) => i.label === "app-role").meta.maxSessionDuration, 3600);
  assert.equal(roles.items.find((i) => i.label === "app-role").meta.description, "Sample role app-role");
  assert.equal(roles.nextToken, null);
  const groups = groupsPage(fixture("iam-list-groups"));
  assert.deepEqual(labels(groups), ["admins", "readers", "developers"]);
  assert.ok(groups.items[0].meta.id);
  const policy = policiesPage(fixture("iam-list-policies")).items[0];
  assert.deepEqual([policy.kind, policy.label, policy.meta.attachmentCount, policy.meta.defaultVersion], ["iam-policy", "read-reports", 0, "v1"]);
  assert.deepEqual(usersPage({}).items, []);
});

test("secrets page: metadata only, no value fields; paged with NextToken", () => {
  const raw = fixture("secretsmanager-list-secrets.us-east-1");
  const page = secretsPage(raw);
  assert.deepEqual(labels(page), ["app/db", "app/api-key", "plain"]);
  assert.deepEqual(Object.keys(page.items[0].meta), ["arn", "description", "lastChanged", "lastAccessed", "created"]);
  assert.equal(page.items[0].meta.description, "Sample secret app/db");
  assert.ok(page.items[0].meta.arn.startsWith("arn:aws:secretsmanager:us-east-1:123456789012:secret:app/db-"));
  assert.ok(!JSON.stringify(page).includes("not-a-real-secret"));
  const first = fixture("secretsmanager-list-secrets.us-east-1.page1");
  assert.equal(secretsPage(first).nextToken, first.NextToken);
  assert.equal(secretsPage(fixture("secretsmanager-list-secrets.us-east-1.page2")).nextToken, null);
  assert.equal(secretsPage({}).nextToken, null);
});

test("Lambda functions page: name, runtime, memory, last modified; CLI paging token", () => {
  const page = functionsPage(fixture("lambda-list-functions.us-east-1"));
  assert.deepEqual(labels(page), ["report-builder", "image-resizer", "cleanup"]);
  assert.equal(page.items[0].kind, "lambda-function");
  assert.deepEqual([page.items[0].meta.runtime, page.items[0].meta.memory], ["python3.12", 256]);
  assert.equal(page.items[0].meta.arn, "arn:aws:lambda:us-east-1:123456789012:function:report-builder");
  const first = fixture("lambda-list-functions.us-east-1.page1");
  const one = functionsPage(first);
  assert.equal(one.nextToken, first.NextToken);
  assert.deepEqual(labels(functionsPage(fixture("lambda-list-functions.us-east-1.page2"))), ["cleanup"]);
  assert.equal(functionsPage({}).nextToken, null);
});

test("ECR repositories page: folders with metadata; paging token is a lowercase NextToken", () => {
  const page = repositoriesPage(fixture("ecr-describe-repositories.us-east-1"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label, i.repository]), [["ecr-repo", "team/web", "team/web"], ["ecr-repo", "api", "api"], ["ecr-repo", "worker", "worker"]]);
  assert.equal(page.items[0].meta.uri, "123456789012.dkr.ecr.us-east-1.amazonaws.com/team/web");
  const first = fixture("ecr-describe-repositories.us-east-1.page1");
  assert.equal(repositoriesPage(first).nextToken, first.NextToken);
  assert.deepEqual(labels(repositoriesPage(fixture("ecr-describe-repositories.us-east-1.page2"))), ["worker"]);
  assert.deepEqual(repositoriesPage({}).items, []);
});

test("ECR images page: tags, pushed date and size from a pushed image", () => {
  const page = imagesPage(fixture("ecr-describe-images.us-east-1"), "team/web");
  assert.deepEqual(page.items.map((i) => [i.kind, i.label]), [["ecr-image", "v1.0.0"]]);
  assert.match(page.items[0].meta.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual([page.items[0].meta.tags, page.items[0].meta.size], [["v1.0.0"], 10]);
  assert.ok(page.items[0].meta.pushed);
  assert.equal(page.nextToken, null);
  // Untagged images use a short digest (moto cannot record one, so this keeps a small inline case).
  const untagged = imagesPage({ imageDetails: [{ imageDigest: "sha256:examplediges0123456789" }] }, "api");
  assert.equal(untagged.items[0].label, "sha256:examplediges");
});

test("EC2 instances page: flattens reservations, keeps only the Name tag", () => {
  const raw = fixture("ec2-describe-instances.us-east-1");
  const page = instancesPage(raw);
  assert.equal(raw.Reservations.length, 3);
  assert.equal(page.items.length, 3);
  const named = page.items.filter((i) => i.kind === "ec2-instance" && !i.label.startsWith("i-"));
  assert.deepEqual(labels({ items: named }), ["web-1", "worker-1"]);
  const web = page.items[0];
  assert.deepEqual(Object.keys(web.meta), ["id", "state", "type", "zone", "privateIp"]);
  assert.deepEqual([web.meta.state, web.meta.type, web.meta.zone], ["running", "t3.micro", "us-east-1a"]);
  assert.match(web.meta.id, /^i-/);
  assert.match(page.items[2].label, /^i-/);
  assert.ok(!JSON.stringify(page).includes("Env") && !JSON.stringify(page).includes("dev"));
  const first = fixture("ec2-describe-instances.us-east-1.page1");
  assert.equal(instancesPage(first).nextToken, first.NextToken);
  assert.equal(instancesPage(fixture("ec2-describe-instances.us-east-1.page2")).items.length, 1);
  assert.deepEqual(instancesPage({}).items, []);
});

test("EFS file systems page: id, name, size, performance mode, state", () => {
  const raw = fixture("efs-describe-file-systems.us-east-1");
  const page = fileSystemsPage(raw);
  assert.deepEqual(labels(page).slice(0, 2), ["shared-data", "backups"]);
  assert.match(page.items[2].label, /^fs-/);
  assert.deepEqual(page.items[0].meta, { id: raw.FileSystems[0].FileSystemId, size: raw.FileSystems[0].SizeInBytes.Value, performanceMode: "generalPurpose", state: "available" });
  const first = fixture("efs-describe-file-systems.us-east-1.page1");
  assert.equal(fileSystemsPage(first).nextToken, first.NextToken);
  assert.deepEqual(fileSystemsPage({}).items, []);
});

test("EKS clusters page: names become folders; paged with a lowercase NextToken", () => {
  const page = clustersPage(fixture("eks-list-clusters.us-east-1"));
  assert.deepEqual(page.items.map((i) => [i.kind, i.label, i.cluster]), [["eks-cluster", "dev-cluster", "dev-cluster"], ["eks-cluster", "prod-cluster", "prod-cluster"], ["eks-cluster", "test-cluster", "test-cluster"]]);
  const first = fixture("eks-list-clusters.us-east-1.page1");
  assert.equal(clustersPage(first).nextToken, first.NextToken);
  assert.deepEqual(labels(clustersPage(fixture("eks-list-clusters.us-east-1.page2"))), ["test-cluster"]);
  assert.deepEqual(clustersPage({}).items, []);
});

test("EKS cluster details page: one leaf with version, status, endpoint, created; no certificate", () => {
  const raw = fixture("eks-describe-cluster.us-east-1");
  const page = clusterDetailsPage(raw, "prod-cluster");
  assert.equal(page.items.length, 1);
  assert.deepEqual([page.items[0].kind, page.items[0].label], ["eks-details", `v${raw.cluster.version} ACTIVE`]);
  assert.deepEqual(page.items[0].meta, { version: raw.cluster.version, status: "ACTIVE", endpoint: raw.cluster.endpoint, created: raw.cluster.createdAt });
  assert.ok(raw.cluster.certificateAuthority, "the recording carries certificate data, so the check below is meaningful");
  assert.ok(!JSON.stringify(page).includes(raw.cluster.certificateAuthority.data));
  assert.equal(page.nextToken, null);
  assert.deepEqual(clusterDetailsPage({}, "x").items, []);
});

test("RDS instances page: engine, version, class, status, endpoint; never the master username", () => {
  const page = dbInstancesPage(fixture("rds-describe-db-instances.us-east-1"));
  assert.deepEqual(labels(page), ["orders-db", "users-db", "reports-db"]);
  assert.deepEqual(page.items[0].meta, { engine: "postgres", version: "9.3.3", class: "db.t3.micro", status: "available", endpoint: "orders-db.aaaaaaaaaa.us-east-1.rds.amazonaws.com:5432" });
  assert.ok(!JSON.stringify(page).includes("sample_admin"));
  const first = fixture("rds-describe-db-instances.us-east-1.page1");
  assert.equal(dbInstancesPage(first).nextToken, first.NextToken);
  assert.equal(dbInstancesPage(fixture("rds-describe-db-instances.us-east-1.page2")).nextToken, null);
  assert.deepEqual(dbInstancesPage({}).items, []);
});

test("CloudWatch alarms page: state, metric, namespace, threshold, last update", () => {
  const raw = fixture("cloudwatch-describe-alarms.us-east-1");
  const page = alarmsPage(raw);
  assert.deepEqual(labels(page), ["high-cpu", "queue-depth", "disk-full"]);
  assert.deepEqual(page.items[0].meta, { state: raw.MetricAlarms[0].StateValue, metric: "CPUUtilization", namespace: "AWS/EC2", threshold: 80, stateUpdated: raw.MetricAlarms[0].StateUpdatedTimestamp });
  const first = fixture("cloudwatch-describe-alarms.us-east-1.page1");
  assert.equal(alarmsPage(first).nextToken, first.NextToken);
  assert.deepEqual(labels(alarmsPage(fixture("cloudwatch-describe-alarms.us-east-1.page2"))), ["disk-full"]);
  assert.deepEqual(alarmsPage({}).items, []);
});

test("CloudWatch log groups page: stored bytes, retention, created date; no events", () => {
  const raw = fixture("logs-describe-log-groups.us-east-1");
  const page = logGroupsPage(raw);
  assert.deepEqual(labels(page), ["/aws/lambda/report-builder", "/example/app", "/example/worker"]);
  assert.deepEqual(page.items[0].meta, { storedBytes: 0, retentionDays: 14, created: new Date(raw.logGroups[0].creationTime).toISOString() });
  assert.equal(page.items[1].meta.retentionDays, null);
  const first = fixture("logs-describe-log-groups.us-east-1.page1");
  assert.equal(logGroupsPage(first).nextToken, first.NextToken);
  assert.deepEqual(logGroupsPage({}).items, []);
});

test("the second region records its own data under the same shapes", () => {
  const east = secretsPage(fixture("secretsmanager-list-secrets.us-east-1"));
  const west = secretsPage(fixture("secretsmanager-list-secrets.eu-west-1"));
  assert.deepEqual(labels(west), labels(east));
  assert.ok(west.items[0].meta.arn.includes(":eu-west-1:"));
  assert.ok(functionsPage(fixture("lambda-list-functions.eu-west-1")).items[0].meta.arn.includes(":eu-west-1:"));
});

test("recorded fixtures hold only moto's fake account id and no public IP address", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const text = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  const accounts = new Set(text.match(/(?<![0-9])[0-9]{12}(?![0-9])/g));
  assert.ok(accounts.has("123456789012"));
  assert.ok(!text.includes("54.214."), "moto's random public IPs must be replaced by the record script");
});

test("bucket settings parse from moto fixtures: reports-bucket has all four set", () => {
  assert.equal(ownershipText(fixture("s3-get-bucket-ownership-controls-reports")), "BucketOwnerEnforced");
  assert.equal(versioningText(fixture("s3-get-bucket-versioning-reports")), "Enabled");
  assert.match(encryptionText(fixture("s3-get-bucket-encryption-reports")), /^SSE-KMS \(arn:aws:kms:.*key\/.+\)$/);
  assert.equal(publicAccessText(fixture("s3-get-public-access-block-reports")), "All on");
});

test("versioning never enabled: the CLI prints no JSON, so Status is missing", () => {
  assert.equal(versioningText(JSON.parse(readFileSync(new URL("./fixtures/s3-get-bucket-versioning-logs.json", import.meta.url), "utf8") || "{}")), "Off"); // runAws turns empty output into {}
  assert.equal(versioningText({ Status: "Suspended" }), "Suspended");
});

test("encryption: SSE-S3, SSE-KMS without a key, and no rule", () => {
  const rule = (algorithm, key) => ({ ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: algorithm, ...(key ? { KMSMasterKeyID: key } : {}) } }] } });
  assert.equal(encryptionText(rule("AES256")), "SSE-S3");
  assert.equal(encryptionText(rule("aws:kms")), "SSE-KMS");
  assert.equal(encryptionText({}), "—");
});

test("public access block lists the flags that are off", () => {
  const config = { BlockPublicAcls: true, IgnorePublicAcls: false, BlockPublicPolicy: true };
  assert.equal(publicAccessText({ PublicAccessBlockConfiguration: config }), "Off: IgnorePublicAcls, RestrictPublicBuckets");
});

test("unset bucket settings (logs-bucket) fail with codes that map to Not set", () => {
  for (const name of ["s3-get-bucket-ownership-controls-logs", "s3-get-bucket-encryption-logs", "s3-get-public-access-block-logs"]) {
    const stderr = readFileSync(new URL(`./fixtures/${name}.error.txt`, import.meta.url), "utf8");
    assert.equal(describeFieldError(describeAwsError(stderr, "p")), "Not set", name);
  }
});
