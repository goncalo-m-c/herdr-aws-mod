import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bucketsPage, objectsPage, parametersPage, usersPage, rolesPage, groupsPage, policiesPage } from "../parse.js";

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
