import { test } from "node:test";
import assert from "node:assert/strict";
import { createTree, emptyTree, toggle, activate, startLoad, finishLoad, failLoad, refresh, select, visibleRows } from "../tree.js";
import { SERVICES } from "../resources.js";

const US = "us-east-1", EU = "eu-west-1";
const bucket = (name) => ({ id: `s3b:${name}`, kind: "bucket", label: name, bucket: name });
const object = (key) => ({ id: `s3o:b/${key}`, kind: "object", label: key, bucket: "b", key });
const types = (tree) => visibleRows(tree).map((r) => `${r.type}:${r.node.label}`);
const REGIONAL = ["Secrets Manager", "Lambda", "ECR", "EC2", "EFS", "EKS", "RDS", "CloudWatch", "SSM Parameter Store"];
const childLabels = (tree, id) => tree.nodes.get(id).children.map((c) => tree.nodes.get(c).label);

test("global comes first, then the regions in the order given, all collapsed", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.deepEqual(types(tree), ["node:global", `node:${US}`, `node:${EU}`]);
  assert.equal([...tree.nodes.values()].some((n) => n.open || n.loading), false);
});

test("one region still gives global and that region's folder", () => {
  assert.deepEqual(types(createTree(SERVICES, [US])), ["node:global", `node:${US}`]);
});

test("opening a top-level folder makes no aws call", () => {
  const tree = createTree(SERVICES, [US]);
  assert.equal(toggle(tree, "global"), false);
  assert.equal(toggle(tree, `region:${US}`), false);
});

test("global lists only S3 and IAM", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.deepEqual(childLabels(tree, "global"), ["S3", "IAM"]);
});

test("each region folder lists the regional services, with @region ids", () => {
  const tree = createTree(SERVICES, [US, EU]);
  for (const region of [US, EU]) {
    assert.deepEqual(childLabels(tree, `region:${region}`), REGIONAL);
    for (const id of tree.nodes.get(`region:${region}`).children) {
      assert.ok(id.endsWith(`@${region}`), id);
      assert.equal(tree.nodes.get(id).region, region);
    }
  }
});

test("global services keep plain ids and carry no region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.equal(tree.nodes.get("s3").region, undefined);
  assert.equal(tree.nodes.get("iam").region, undefined);
});

test("an empty tree has no rows", () => {
  assert.deepEqual(visibleRows(emptyTree()), []);
});

test("overlapping loads are refused while one runs", () => {
  const tree = createTree(SERVICES, [US]);
  toggle(tree, "global");
  toggle(tree, "s3");
  const ticket = startLoad(tree, "s3");
  assert.ok(ticket);
  assert.equal(startLoad(tree, "s3"), null);
  assert.deepEqual(types(tree), ["node:global", "node:S3", "loading:S3", "node:IAM", `node:${US}`]);
  finishLoad(tree, "s3", ticket, { items: [bucket("b2"), bucket("a1")], nextToken: "t1" });
  assert.deepEqual(types(tree), ["node:global", "node:S3", "node:a1", "node:b2", "more:S3", "node:IAM", `node:${US}`]);
});

test("load more appends the next page and ends when the token runs out", () => {
  const tree = createTree(SERVICES, [US]);
  toggle(tree, "global");
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucket("a")], nextToken: "t1" });
  const more = startLoad(tree, "s3", { more: true });
  assert.equal(more.token, "t1");
  finishLoad(tree, "s3", more, { items: [bucket("b"), bucket("a")], nextToken: null });
  assert.deepEqual(types(tree), ["node:global", "node:S3", "node:a", "node:b", "node:IAM", `node:${US}`]);
  assert.equal(startLoad(tree, "s3", { more: true }), null);
});

test("refresh drops stale results and the selection under it", () => {
  const tree = createTree(SERVICES, [US]);
  toggle(tree, "global");
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
  assert.deepEqual(types(tree), ["node:global", "node:S3", "node:new", "node:IAM", `node:${US}`]);
});

test("errors and empty folders show as rows; reopening retries", () => {
  const tree = createTree(SERVICES, [US]);
  const id = `ssm@${US}`;
  toggle(tree, `region:${US}`);
  toggle(tree, id);
  failLoad(tree, id, startLoad(tree, id), "Access denied");
  assert.equal(types(tree).at(-1), "error:SSM Parameter Store");
  toggle(tree, id);
  assert.equal(toggle(tree, id), true);
  finishLoad(tree, id, startLoad(tree, id), { items: [], nextToken: null });
  assert.equal(types(tree).at(-1), "empty:SSM Parameter Store");
});

test("leaves do not toggle", () => {
  const tree = createTree(SERVICES, [US]);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [object("x")], nextToken: null });
  assert.equal(toggle(tree, "s3o:b/x"), false);
});

test("a regional service loads its own children, tagged with the region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  const param = { id: "ssmp:/a", kind: "parameter", label: "a", name: "/a" };
  for (const region of [US, EU]) {
    const id = `ssm@${region}`;
    assert.equal(toggle(tree, id), true);
    finishLoad(tree, id, startLoad(tree, id), { items: [param], nextToken: null });
  }
  assert.equal(tree.nodes.get(`ssmp:/a@${US}`).region, US);
  assert.equal(tree.nodes.get(`ssmp:/a@${EU}`).region, EU);
});

test("IAM has four fixed folders and makes no call to open", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.equal(toggle(tree, "iam"), false);
  assert.deepEqual(childLabels(tree, "iam"), ["Users", "Roles", "Groups", "Policies (local)"]);
  assert.equal(refresh(tree, "iam"), false);
});

test("an IAM folder loads its own list with no region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.equal(toggle(tree, "iam:iam-users"), true);
  finishLoad(tree, "iam:iam-users", startLoad(tree, "iam:iam-users"), { items: [{ id: "iamu:alice", kind: "iam-user", label: "alice", name: "alice" }], nextToken: null });
  assert.equal(tree.nodes.get("iamu:alice").region, undefined);
});

test("a repository and a cluster open under their region folder, keeping the region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  finishLoad(tree, `ecr@${EU}`, startLoad(tree, `ecr@${EU}`), { items: [{ id: "ecr:api", kind: "ecr-repo", label: "api", repository: "api" }], nextToken: null });
  assert.equal(tree.nodes.get(`ecr:api@${EU}`).region, EU);
  assert.equal(toggle(tree, `ecr:api@${EU}`), true);
  finishLoad(tree, `eks@${EU}`, startLoad(tree, `eks@${EU}`), { items: [{ id: "eks:prod", kind: "eks-cluster", label: "prod", cluster: "prod" }], nextToken: null });
  assert.equal(tree.nodes.get(`eks:prod@${EU}`).region, EU);
  assert.equal(toggle(tree, `eks:prod@${EU}`), true);
});

test("every node under a region folder has an id ending in @region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  for (const region of [US, EU]) {
    const walk = (id) => {
      assert.ok(id.endsWith(`@${region}`), id);
      for (const child of tree.nodes.get(id).children) walk(child);
    };
    for (const id of tree.nodes.get(`region:${region}`).children) walk(id);
  }
});

test("CloudWatch holds its own folders per region, loaded in that region", () => {
  const tree = createTree(SERVICES, [US, EU]);
  assert.deepEqual(childLabels(tree, `cloudwatch@${EU}`), ["Alarms", "Log groups"]);
  const id = `cloudwatch:cw-alarms@${EU}`;
  assert.equal(tree.nodes.get(id).region, EU);
  assert.equal(toggle(tree, id), true);
  finishLoad(tree, id, startLoad(tree, id), { items: [{ id: "cwa:high-cpu", kind: "cw-alarm", label: "high-cpu" }], nextToken: null });
  assert.equal(tree.nodes.get(`cwa:high-cpu@${EU}`).region, EU);
});

test("a bucket under global > S3 is selected on click, a top-level folder is only toggled", () => {
  const tree = createTree(SERVICES, [US]);
  for (const id of ["global", `region:${US}`]) {
    activate(tree, id);
    assert.equal(tree.selected, null, id);
    assert.equal(tree.nodes.get(id).open, true, id);
  }
  assert.equal(activate(tree, "s3"), true);
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucket("b")], nextToken: null });
  assert.equal(activate(tree, "s3b:b"), true);
  assert.equal(tree.selected, "s3b:b");
  assert.equal(tree.nodes.get("s3b:b").open, true);
});
