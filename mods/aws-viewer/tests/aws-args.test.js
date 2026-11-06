import { test } from "node:test";
import assert from "node:assert/strict";
import { invocation, listBuckets, listObjects, describeParameters, configuredRegion, isReadOnly, listUsers, listRoles, listGroups, listLocalPolicies, listSecrets, listFunctions, describeRepositories, describeImages, describeInstances, describeFileSystems, listClusters, describeCluster, describeDbInstances, describeAlarms, describeLogGroups, regionList, pickRegions, needsRegionLookup, regionsOutcome, NO_REGION_MESSAGE, Refusal, PAGE_SIZE } from "../aws-args.js";

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

test("list-secrets is allowed, one page, and secret values are refused", () => {
  assert.deepEqual(invocation(listSecrets(null), { profile: "dev", region: "eu-west-1" }), [
    "secretsmanager", "list-secrets", "--no-paginate", `--max-results=${PAGE_SIZE}`,
    "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(listSecrets("t").includes("--next-token=t"));
  for (const command of [
    ["secretsmanager", "get-secret-value", "--secret-id=x"], ["secretsmanager", "batch-get-secret-value"], ["secretsmanager", "describe-secret", "--secret-id=x"],
    ["secretsmanager", "create-secret"], ["secretsmanager", "put-secret-value"], ["secretsmanager", "delete-secret"],
  ]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("list-functions is allowed, one CLI-paged call, and other Lambda calls are refused", () => {
  assert.deepEqual(invocation(listFunctions(null), DEV), [
    "lambda", "list-functions", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(listFunctions("t").includes("--starting-token=t"));
  assert.ok(!listFunctions("t").includes("--no-paginate"));
  for (const command of [
    ["lambda", "invoke", "--function-name=x"], ["lambda", "get-function", "--function-name=x"], ["lambda", "create-function"],
    ["lambda", "delete-function", "--function-name=x"], ["lambda", "update-function-code"], ["lambda", "list-layers"],
  ]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("ECR describe calls are allowed, CLI-paged, and writes are refused", () => {
  assert.deepEqual(invocation(describeRepositories(null), DEV), [
    "ecr", "describe-repositories", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.deepEqual(describeImages("team/web", "t"), ["ecr", "describe-images", "--repository-name=team/web", `--max-items=${PAGE_SIZE}`, "--starting-token=t"]);
  assert.ok(isReadOnly(describeImages("api", null)));
  assert.ok(!describeRepositories("t").includes("--no-paginate") && !describeImages("api", "t").includes("--no-paginate"));
  assert.throws(() => describeImages("file://etc/passwd", null), Refusal);
  for (const command of [
    ["ecr", "get-login-password"], ["ecr", "get-authorization-token"], ["ecr", "batch-get-image"], ["ecr", "delete-repository", "--repository-name=x"],
    ["ecr", "create-repository"], ["ecr", "batch-delete-image"], ["ecr", "put-image"], ["ecr", "list-images", "--repository-name=x"],
  ]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("EC2 describe-instances is allowed, CLI-paged, and writes and risky reads are refused", () => {
  assert.deepEqual(invocation(describeInstances(null), DEV), [
    "ec2", "describe-instances", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(describeInstances("t").includes("--starting-token=t"));
  assert.ok(!describeInstances("t").includes("--no-paginate"));
  for (const command of [
    ["ec2", "run-instances"], ["ec2", "terminate-instances", "--instance-ids=i-0123456789EXAMPLE1"], ["ec2", "get-console-output", "--instance-id=i-0123456789EXAMPLE1"],
    ["ec2", "get-password-data", "--instance-id=i-0123456789EXAMPLE1"], ["ec2", "describe-instance-attribute", "--attribute=userData"], ["ec2", "start-instances"],
  ]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("EFS describe-file-systems is allowed, CLI-paged, and writes are refused", () => {
  assert.deepEqual(invocation(describeFileSystems(null), DEV), [
    "efs", "describe-file-systems", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(describeFileSystems("t").includes("--starting-token=t"));
  assert.ok(!describeFileSystems("t").includes("--no-paginate"));
  for (const command of [["efs", "create-file-system"], ["efs", "delete-file-system", "--file-system-id=x"], ["efs", "describe-file-system-policy"], ["efs", "describe-mount-targets"]]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("EKS list-clusters and describe-cluster are allowed, and writes are refused", () => {
  assert.deepEqual(invocation(listClusters(null), DEV), [
    "eks", "list-clusters", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(listClusters("t").includes("--starting-token=t"));
  assert.ok(!listClusters("t").includes("--no-paginate"));
  assert.deepEqual(describeCluster("prod-cluster"), ["eks", "describe-cluster", "--name=prod-cluster"]);
  assert.ok(isReadOnly(describeCluster("prod-cluster")));
  assert.throws(() => describeCluster("file://etc/passwd"), Refusal);
  for (const command of [["eks", "create-cluster", "--name=x"], ["eks", "delete-cluster", "--name=x"], ["eks", "update-cluster-config"], ["eks", "get-token", "--cluster-name=x"], ["eks", "update-kubeconfig"]]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("RDS describe-db-instances is allowed, CLI-paged, and writes are refused", () => {
  assert.deepEqual(invocation(describeDbInstances(null), DEV), [
    "rds", "describe-db-instances", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(describeDbInstances("t").includes("--starting-token=t"));
  assert.ok(!describeDbInstances("t").includes("--no-paginate"));
  for (const command of [["rds", "delete-db-instance", "--db-instance-identifier=x"], ["rds", "create-db-instance"], ["rds", "modify-db-instance"], ["rds", "generate-db-auth-token"], ["rds", "describe-db-snapshots"]]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("CloudWatch describe-alarms is allowed, CLI-paged, and metric reads and writes are refused", () => {
  assert.deepEqual(invocation(describeAlarms(null), DEV), [
    "cloudwatch", "describe-alarms", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(describeAlarms("t").includes("--starting-token=t"));
  assert.ok(!describeAlarms("t").includes("--no-paginate"));
  for (const command of [["cloudwatch", "get-metric-data"], ["cloudwatch", "put-metric-alarm"], ["cloudwatch", "delete-alarms"], ["cloudwatch", "describe-alarm-history"]]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("CloudWatch Logs describe-log-groups is allowed and CLI-paged; reading log content and writes are refused", () => {
  assert.deepEqual(invocation(describeLogGroups(null), DEV), [
    "logs", "describe-log-groups", `--max-items=${PAGE_SIZE}`, "--profile=dev", "--region=eu-west-1", "--output=json", "--no-cli-pager", "--no-cli-auto-prompt",
  ]);
  assert.ok(describeLogGroups("t").includes("--starting-token=t"));
  assert.ok(!describeLogGroups("t").includes("--no-paginate"));
  for (const command of [["logs", "get-log-events"], ["logs", "filter-log-events"], ["logs", "start-query"], ["logs", "tail"], ["logs", "delete-log-group"], ["logs", "create-log-group"]]) {
    assert.equal(isReadOnly(command), false, command.join(" "));
    assert.throws(() => invocation(command, DEV), Refusal, command.join(" "));
  }
});

test("pickRegions prefers the list, then the fallback, else none", () => {
  assert.deepEqual(pickRegions(["eu-west-1"], "us-east-1"), ["eu-west-1"]);
  assert.deepEqual(pickRegions(undefined, "us-east-1"), ["us-east-1"]);
  assert.deepEqual(pickRegions(undefined, ""), []);
});

test("regionsOutcome: a bad regions prop gives no regions and the refusal", () => {
  const out = regionsOutcome("us east", "us-east-1");
  assert.equal(out.regions, null);
  assert.match(out.error, /not a valid AWS region name/);
});

test("regionsOutcome: no region says so, a failed lookup shows its error", () => {
  assert.deepEqual(regionsOutcome(undefined, ""), { regions: [], error: NO_REGION_MESSAGE });
  assert.deepEqual(regionsOutcome(undefined, "", "Profile x is not in your AWS config."), { regions: [], error: "Profile x is not in your AWS config." });
  assert.deepEqual(regionsOutcome(["eu-west-1"], "", "ignored"), { regions: ["eu-west-1"], error: "" });
});

test("needsRegionLookup only when no region and no usable regions prop", () => {
  assert.equal(needsRegionLookup(undefined, ""), true);
  assert.equal(needsRegionLookup(["eu-west-1"], ""), false);
  assert.equal(needsRegionLookup(undefined, "us-east-1"), false);
  assert.equal(needsRegionLookup("bad", ""), false);
});
