import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describeAwsError, describeExecFailure } from "../errors.js";
import { parseShellEnv, resolveTarget, needsShellEnv, ENV_MARKER } from "../context.js";
import { detailFields, formatSize, formatDate } from "../format.js";

test("aws errors become short messages", () => {
  assert.match(describeAwsError("Error when retrieving token from sso: Token has expired and refresh failed", "dev"), /expired/);
  assert.match(describeAwsError("aws: [ERROR]: An error occurred (NoCredentials): Unable to locate credentials.", "dev"), /No credentials/);
  assert.match(describeAwsError("An error occurred (AccessDenied) when calling the ListBuckets operation: Access Denied", "p"), /Access denied/);
  assert.match(describeAwsError("An error occurred (AccessDeniedException) when calling the DescribeParameters operation", "p"), /Access denied/);
  assert.match(describeAwsError("The config profile (dev) could not be found", "dev"), /not in your AWS config/);
  assert.equal(describeAwsError("aws: [ERROR]: Something odd\nmore", "p"), "Something odd");
  assert.equal(describeAwsError("", "p"), "The aws command failed with no message.");
  assert.match(describeExecFailure(new Error("No such file or directory (os error 2)")), /aws CLI was not found/);
});

test("login shell env: junk before the marker is ignored, region falls back", () => {
  const out = `motd line\n${ENV_MARKER}\ndev\n\neu-central-1\n`;
  assert.deepEqual(parseShellEnv(out), { profile: "dev", region: "eu-central-1" });
  assert.deepEqual(parseShellEnv("no marker"), { profile: "", region: "" });
});

test("props win over the shell", () => {
  const target = resolveTarget({ profile: "staging-eu" }, { profile: "prod", region: "us-east-1" });
  assert.deepEqual(target, { profile: "staging-eu", region: "us-east-1", profileSource: "props", regionSource: "env" });
  assert.equal(needsShellEnv({ profile: "a", region: "b" }), false);
  assert.equal(needsShellEnv({}), true);
});

test("details show metadata fields only", () => {
  const fields = detailFields({ kind: "parameter", name: "/a/b", meta: { type: "SecureString", version: 7, tier: "Standard" } });
  assert.deepEqual(fields.map(([label]) => label), ["Name", "Type", "Version", "Last modified", "Description", "Tier", "Data type"]);
  const object = detailFields({ kind: "object", bucket: "b", key: "k", meta: { size: 1536, etag: '"ab"' } });
  assert.deepEqual(object.find(([l]) => l === "ETag"), ["ETag", "ab"]);
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatDate("2024-04-10T14:22:31.123000+00:00"), "2024-04-10 14:22 UTC");
});

test("IAM details show main fields", () => {
  const user = detailFields({ kind: "iam-user", name: "alice", meta: { arn: "arn:aws:iam::123456789012:user/alice", created: "2024-01-15T10:00:00+00:00" } });
  assert.deepEqual(user.map(([l]) => l), ["Name", "ARN", "User ID", "Path", "Created", "Password last used"]);
  assert.deepEqual(user[4], ["Created", "2024-01-15 10:00 UTC"]);
  for (const kind of ["iam-role", "iam-group", "iam-policy"]) assert.ok(detailFields({ kind, name: "x" }).length >= 5, kind);
});

test("source never reads values, writes files or logs, and runs aws in one place", () => {
  const dir = new URL("../", import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(new URL(f, dir), "utf8")]);
  for (const [file, text] of sources) {
    for (const banned of ["--with-decryption", "get-parameter", "get-object", "get-secret-value", "console.log", "writeTextFile", "fs/promises", "localStorage"]) {
      assert.ok(!text.includes(banned), `${file} mentions ${banned}`);
    }
  }
  const runsAws = sources.filter(([, text]) => /exec\(\s*"aws"/.test(text)).map(([f]) => f);
  assert.deepEqual(runsAws, ["aws.js"]);
});

test("Lambda details show name, runtime, memory and last modified", () => {
  const fields = detailFields({ kind: "lambda-function", name: "report-builder", meta: { runtime: "python3.12", memory: 256, lastModified: "2024-05-01T08:30:00.000+0000" } });
  assert.deepEqual(fields.slice(0, 4), [["Name", "report-builder"], ["Runtime", "python3.12"], ["Memory", "256 MB"], ["Last modified", "2024-05-01 08:30 UTC"]]);
});

test("ECR image details show tags, pushed date and size", () => {
  const fields = detailFields({ kind: "ecr-image", repository: "api", meta: { tags: ["latest", "v1"], pushed: "2024-05-01T08:30:00+00:00", size: 52428800, digest: "sha256:x" } });
  assert.deepEqual(fields.slice(0, 4), [["Repository", "api"], ["Tags", "latest, v1"], ["Pushed", "2024-05-01 08:30 UTC"], ["Size", "50 MB (52,428,800 bytes)"]]);
  assert.equal(detailFields({ kind: "ecr-image", meta: {} })[1][1], "(untagged)");
});

test("EC2 instance details show id, name, state, type, zone and private IP", () => {
  const fields = detailFields({ kind: "ec2-instance", name: "web-1", meta: { id: "i-0123456789EXAMPLE1", state: "running", type: "t3.micro", zone: "eu-west-1a", privateIp: "10.0.0.11" } });
  assert.deepEqual(fields, [["Instance ID", "i-0123456789EXAMPLE1"], ["Name", "web-1"], ["State", "running"], ["Type", "t3.micro"], ["Zone", "eu-west-1a"], ["Private IP", "10.0.0.11"]]);
});

test("EFS details show id, name, size, performance mode and state", () => {
  const fields = detailFields({ kind: "efs-filesystem", name: "shared-data", meta: { id: "fs-0123EXAMPLE1", size: 6144, performanceMode: "generalPurpose", state: "available" } });
  assert.deepEqual(fields, [["File system ID", "fs-0123EXAMPLE1"], ["Name", "shared-data"], ["Size", "6 KB (6,144 bytes)"], ["Performance mode", "generalPurpose"], ["State", "available"]]);
});

test("EKS details show version, status, endpoint and created date", () => {
  const fields = detailFields({ kind: "eks-details", name: "prod-cluster", meta: { version: "1.30", status: "ACTIVE", endpoint: "https://EXAMPLE.eks.amazonaws.com", created: "2024-05-01T08:30:00.000000+00:00" } });
  assert.deepEqual(fields, [["Cluster", "prod-cluster"], ["Version", "1.30"], ["Status", "ACTIVE"], ["Endpoint", "https://EXAMPLE.eks.amazonaws.com"], ["Created", "2024-05-01 08:30 UTC"]]);
});

test("RDS details show identifier, engine, version, class, status and endpoint", () => {
  const fields = detailFields({ kind: "rds-instance", name: "orders-db", meta: { engine: "postgres", version: "16.3", class: "db.t3.micro", status: "available", endpoint: "orders-db.EXAMPLE.rds.amazonaws.com:5432" } });
  assert.deepEqual(fields, [["Identifier", "orders-db"], ["Engine", "postgres"], ["Version", "16.3"], ["Class", "db.t3.micro"], ["Status", "available"], ["Endpoint", "orders-db.EXAMPLE.rds.amazonaws.com:5432"]]);
  assert.ok(!fields.some(([label]) => /user|password/i.test(label)));
});

test("CloudWatch alarm details show name, state, metric, namespace, threshold and last update", () => {
  const fields = detailFields({ kind: "cw-alarm", name: "high-cpu", meta: { state: "ALARM", metric: "CPUUtilization", namespace: "AWS/EC2", threshold: 80, stateUpdated: "2024-06-01T10:15:00.000000+00:00" } });
  assert.deepEqual(fields, [["Name", "high-cpu"], ["State", "ALARM"], ["Metric", "CPUUtilization"], ["Namespace", "AWS/EC2"], ["Threshold", 80], ["Last state update", "2024-06-01 10:15 UTC"]]);
});

test("CloudWatch log group details show name, stored bytes, retention and created date", () => {
  const fields = detailFields({ kind: "cw-log-group", name: "/example/app", meta: { storedBytes: 2048, retentionDays: 14, created: "2024-04-01T00:00:00.000Z" } });
  assert.deepEqual(fields, [["Name", "/example/app"], ["Stored", "2 KB (2,048 bytes)"], ["Retention", "14 days"], ["Created", "2024-04-01 00:00 UTC"]]);
  assert.equal(detailFields({ kind: "cw-log-group", name: "x", meta: {} })[2][1], "Never expire");
});
