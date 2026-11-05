import { test } from "node:test";
import assert from "node:assert/strict";
import { createTree, toggle, startLoad, finishLoad, failLoad, refresh, select, visibleRows } from "../tree.js";
import { SERVICES } from "../resources.js";

const bucket = (name) => ({ id: `s3b:${name}`, kind: "bucket", label: name, bucket: name });
const object = (key) => ({ id: `s3o:b/${key}`, kind: "object", label: key, bucket: "b", key });
const types = (tree) => visibleRows(tree).map((r) => `${r.type}:${r.node.label}`);

test("nothing loads until a folder opens", () => {
  const tree = createTree(SERVICES);
  assert.deepEqual(types(tree), ["node:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
  assert.equal(toggle(tree, "s3"), true);
  assert.equal(toggle(tree, "s3"), false);
});

test("overlapping loads are refused while one runs", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  const ticket = startLoad(tree, "s3");
  assert.ok(ticket);
  assert.equal(startLoad(tree, "s3"), null);
  assert.deepEqual(types(tree), ["node:S3", "loading:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
  finishLoad(tree, "s3", ticket, { items: [bucket("b2"), bucket("a1")], nextToken: "t1" });
  assert.deepEqual(types(tree), ["node:S3", "node:a1", "node:b2", "more:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
});

test("load more appends the next page and ends when the token runs out", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucket("a")], nextToken: "t1" });
  const more = startLoad(tree, "s3", { more: true });
  assert.equal(more.token, "t1");
  finishLoad(tree, "s3", more, { items: [bucket("b"), bucket("a")], nextToken: null });
  assert.deepEqual(types(tree), ["node:S3", "node:a", "node:b", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
  assert.equal(startLoad(tree, "s3", { more: true }), null);
});

test("refresh drops stale results and the selection under it", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucket("b")], nextToken: null });
  toggle(tree, "s3b:b");
  finishLoad(tree, "s3b:b", startLoad(tree, "s3b:b"), { items: [object("k1")], nextToken: null });
  select(tree, "s3o:b/k1");
  const stale = startLoad(tree, "s3", { more: false });
  assert.equal(refresh(tree, "s3"), true);
  assert.equal(tree.selected, null);
  assert.equal(tree.nodes.has("s3o:b/k1"), false);
  const fresh = startLoad(tree, "s3");
  assert.equal(finishLoad(tree, "s3", stale, { items: [bucket("old")], nextToken: null }), false);
  finishLoad(tree, "s3", fresh, { items: [bucket("new")], nextToken: null });
  assert.deepEqual(types(tree), ["node:S3", "node:new", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
});

test("errors and empty folders show as rows; reopening retries", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "ssm");
  failLoad(tree, "ssm", startLoad(tree, "ssm"), "Access denied");
  assert.deepEqual(types(tree), ["node:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store", "error:SSM Parameter Store"]);
  toggle(tree, "ssm");
  assert.equal(toggle(tree, "ssm"), true);
  finishLoad(tree, "ssm", startLoad(tree, "ssm"), { items: [], nextToken: null });
  assert.deepEqual(types(tree), ["node:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store", "empty:SSM Parameter Store"]);
});

test("leaves do not toggle", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [object("x")], nextToken: null });
  assert.equal(toggle(tree, "s3o:b/x"), false);
});

test("regions give SSM one group per region and S3 once", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "ssm");
  assert.deepEqual(types(tree), ["node:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(toggle(tree, "ssm@eu-west-1"), true);
  assert.equal(tree.nodes.get("ssm@eu-west-1").region, "eu-west-1");
});

test("a region group loads its own children, tagged with the region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  const param = { id: "ssmp:/a", kind: "parameter", label: "a", name: "/a" };
  for (const id of ["ssm@us-east-1", "ssm@eu-west-1"]) { toggle(tree, "ssm"); toggle(tree, id); finishLoad(tree, id, startLoad(tree, id), { items: [param], nextToken: null }); }
  assert.equal(tree.nodes.get("ssmp:/a@us-east-1").region, "us-east-1");
  assert.equal(tree.nodes.get("ssmp:/a@eu-west-1").region, "eu-west-1");
});

test("without regions the tree is unchanged", () => {
  assert.deepEqual(types(createTree(SERVICES, [])), ["node:S3", "node:IAM", "node:Secrets Manager", "node:Lambda", "node:ECR", "node:EC2", "node:EFS", "node:EKS", "node:RDS", "node:CloudWatch", "node:SSM Parameter Store"]);
  assert.equal(createTree(SERVICES).nodes.get("ssm").kind, "ssm");
});

test("IAM shows once with four folders, whatever the regions", () => {
  for (const regions of [[], ["us-east-1", "eu-west-1", "ap-south-1"]]) {
    const tree = createTree(SERVICES, regions);
    assert.equal(tree.roots.filter((id) => id === "iam").length, 1);
    assert.equal(tree.nodes.get("iam").region, undefined);
    assert.equal(toggle(tree, "iam"), false); // already loaded: no aws call
    assert.deepEqual(types(tree).filter((t) => t.startsWith("node:") && !["node:S3", "node:IAM"].some((x) => x === t) && /Users|Roles|Groups|local/.test(t)),
      ["node:Users", "node:Roles", "node:Groups", "node:Policies (local)"]);
    assert.equal(refresh(tree, "iam"), false);
  }
});

test("an IAM folder loads its own list and keeps the same ids in every region setup", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "iam");
  assert.equal(toggle(tree, "iam:iam-users"), true);
  finishLoad(tree, "iam:iam-users", startLoad(tree, "iam:iam-users"), { items: [{ id: "iamu:alice", kind: "iam-user", label: "alice", name: "alice" }], nextToken: null });
  assert.equal(tree.nodes.get("iamu:alice").region, undefined);
});

test("Secrets Manager shows once per region while IAM stays single", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "secrets");
  assert.deepEqual(types(tree).filter((t) => /Secrets|-1$/.test(t)), ["node:Secrets Manager", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(tree.nodes.get("secrets@eu-west-1").region, "eu-west-1");
  assert.equal(tree.roots.filter((id) => id === "iam").length, 1);
  assert.equal(createTree(SERVICES, []).nodes.get("secrets").kind, "secrets");
});

test("Lambda shows one group per region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "lambda");
  assert.deepEqual(types(tree).filter((t) => /Lambda|-1$/.test(t)), ["node:Lambda", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(tree.nodes.get("lambda@eu-west-1").region, "eu-west-1");
});

test("ECR shows a group per region and a repository opens to its images", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "ecr");
  assert.deepEqual(types(tree).filter((t) => /ECR|-1$/.test(t)), ["node:ECR", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(toggle(tree, "ecr@eu-west-1"), true);
  finishLoad(tree, "ecr@eu-west-1", startLoad(tree, "ecr@eu-west-1"), { items: [{ id: "ecr:api", kind: "ecr-repo", label: "api", repository: "api" }], nextToken: null });
  assert.equal(tree.nodes.get("ecr:api@eu-west-1").region, "eu-west-1");
  assert.equal(toggle(tree, "ecr:api@eu-west-1"), true);
});

test("EC2 shows one group per region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "ec2");
  assert.deepEqual(types(tree).filter((t) => /EC2|-1$/.test(t)), ["node:EC2", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(tree.nodes.get("ec2@eu-west-1").region, "eu-west-1");
});

test("EFS shows one group per region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "efs");
  assert.deepEqual(types(tree).filter((t) => /EFS|-1$/.test(t)), ["node:EFS", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(tree.nodes.get("efs@eu-west-1").region, "eu-west-1");
});

test("EKS shows a group per region and a cluster opens to its details", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "eks");
  assert.deepEqual(types(tree).filter((t) => /EKS|-1$/.test(t)), ["node:EKS", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(toggle(tree, "eks@eu-west-1"), true);
  finishLoad(tree, "eks@eu-west-1", startLoad(tree, "eks@eu-west-1"), { items: [{ id: "eks:prod", kind: "eks-cluster", label: "prod", cluster: "prod" }], nextToken: null });
  assert.equal(tree.nodes.get("eks:prod@eu-west-1").region, "eu-west-1");
  assert.equal(toggle(tree, "eks:prod@eu-west-1"), true);
});

test("RDS shows one group per region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "rds");
  assert.deepEqual(types(tree).filter((t) => /RDS|-1$/.test(t)), ["node:RDS", "node:us-east-1", "node:eu-west-1"]);
  assert.equal(tree.nodes.get("rds@eu-west-1").region, "eu-west-1");
});

test("CloudWatch shows a group per region, each with its own folders that load in that region", () => {
  const tree = createTree(SERVICES, ["us-east-1", "eu-west-1"]);
  toggle(tree, "cloudwatch");
  toggle(tree, "cloudwatch@eu-west-1");
  assert.deepEqual(types(tree).filter((t) => /CloudWatch|-1$|Alarms|Log groups/.test(t)), ["node:CloudWatch", "node:us-east-1", "node:eu-west-1", "node:Alarms", "node:Log groups"]);
  const id = "cloudwatch@eu-west-1:cw-alarms";
  assert.equal(tree.nodes.get(id).region, "eu-west-1");
  assert.equal(toggle(tree, id), true);
  finishLoad(tree, id, startLoad(tree, id), { items: [{ id: "cwa:high-cpu", kind: "cw-alarm", label: "high-cpu" }], nextToken: null });
  assert.equal(tree.nodes.get("cwa:high-cpu@eu-west-1").region, "eu-west-1");
});

test("CloudWatch without regions is one root with its folders", () => {
  const tree = createTree(SERVICES, []);
  toggle(tree, "cloudwatch");
  assert.deepEqual(types(tree).filter((t) => /CloudWatch|Alarms|Log groups/.test(t)), ["node:CloudWatch", "node:Alarms", "node:Log groups"]);
});
