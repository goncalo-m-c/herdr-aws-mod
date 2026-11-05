import { test } from "node:test";
import assert from "node:assert/strict";
import { invocation, listBuckets, listObjects, describeParameters, configuredRegion, isReadOnly, listUsers, listRoles, listGroups, listLocalPolicies, regionList, Refusal, PAGE_SIZE } from "../aws-args.js";

const DEV = { profile: "dev", region: "eu-west-1" };

test("list-buckets argv: one page, target flags", () => {
  assert.deepEqual(invocation(listBuckets(null), DEV), [
    "s3api", "list-buckets", "--no-paginate", `--max-buckets=${PAGE_SIZE}`,
    "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
});

test("next page passes the token", () => {
  assert.ok(listBuckets("tok").includes("--continuation-token=tok"));
  assert.ok(listObjects("b", "p/", "tok2").includes("--continuation-token=tok2"));
  assert.ok(describeParameters("", "tok3").includes("--next-token=tok3"));
});

test("list-objects-v2 lists one level with a delimiter", () => {
  assert.deepEqual(listObjects("my-bucket", "reports/", null), [
    "s3api", "list-objects-v2", "--no-paginate", "--bucket=my-bucket", "--prefix=reports/", "--delimiter=/", `--max-keys=${PAGE_SIZE}`,
  ]);
  assert.ok(!listObjects("b", "", null).some((a) => a.startsWith("--prefix")));
});

test("values that start with '-' stay values", () => {
  assert.ok(listObjects("b", "-rf/", null).includes("--prefix=-rf/"));
});

test("file:// and URL-like names are refused, never handed to the CLI", () => {
  assert.throws(() => listObjects("b", "file:///home/me/.aws/credentials", null), Refusal);
  assert.throws(() => listObjects("fileb://x", "", null), Refusal);
  // SSM paths go inside a JSON filter, so the value starts with "[" and is never a file reference.
  const filter = describeParameters("file:///x", null).find((a) => a.startsWith("--parameter-filters="));
  assert.ok(filter.startsWith("--parameter-filters=["));
});

test("describe-parameters filters by path recursively, root lists all", () => {
  const args = describeParameters("/app/dev", null);
  assert.ok(args.includes('--parameter-filters=[{"Key":"Path","Option":"Recursive","Values":["/app/dev"]}]'));
  assert.ok(args.includes(`--max-results=${PAGE_SIZE}`));
  assert.ok(!describeParameters("", null).some((a) => a.startsWith("--parameter-filters")));
});

test("only read-only commands, never decryption", () => {
  for (const command of [
    ["ssm", "get-parameter", "--name=/x"], ["ssm", "get-parameters", "--names=/x"], ["ssm", "get-parameters-by-path", "--path=/x"],
    ["ssm", "describe-parameters", "--with-decryption"], ["s3api", "get-object", "--bucket=b"], ["s3", "cp", "s3://b/k", "."],
    ["s3api", "put-object"], ["s3api", "delete-object"], ["ssm", "put-parameter"],
  ]) assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  for (const command of [listBuckets(null), listObjects("b", "p/", "t"), describeParameters("/a", "t"), configuredRegion()]) {
    assert.ok(isReadOnly(command));
  }
});

test("region must look like a region; empty region is left to the profile", () => {
  assert.throws(() => invocation(listBuckets(null), { profile: "dev", region: "--endpoint-url=http://x" }), Refusal);
  assert.ok(!invocation(listBuckets(null), { profile: "dev", region: "" }).some((a) => a.startsWith("--region")));
});

test("regions prop: valid names pass, missing means none, a bad name is refused", () => {
  assert.deepEqual(regionList(["us-east-1", "eu-west-1"]), ["us-east-1", "eu-west-1"]);
  assert.deepEqual(regionList(undefined), []);
  assert.throws(() => regionList(["us-east-1", "nope; rm"]), Refusal);
  assert.throws(() => regionList("us-east-1"), Refusal);
});

test("IAM list calls are allowed, one bounded page each, with the CLI token", () => {
  assert.deepEqual(invocation(listUsers(null), DEV), [
    "iam", "list-users", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(listRoles("t").includes("--starting-token=t"));
  assert.ok(listGroups(null).includes(`--max-items=${PAGE_SIZE}`));
  assert.ok(listLocalPolicies(null).includes("--scope=Local"));
  for (const command of [listUsers(null), listRoles(null), listGroups(null), listLocalPolicies("t")]) assert.ok(isReadOnly(command));
});

test("IAM write and other read calls are refused", () => {
  for (const command of [
    ["iam", "create-user", "--user-name=x"], ["iam", "delete-role", "--role-name=x"], ["iam", "attach-user-policy"],
    ["iam", "create-access-key"], ["iam", "get-user"], ["iam", "list-access-keys"], ["iam", "get-policy-version"],
  ]) assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
});
