import { test } from "node:test";
import assert from "node:assert/strict";
import { createTree, toggle, startLoad, finishLoad, failLoad, refresh, select, visibleRows } from "../tree.js";
import { SERVICES } from "../resources.js";

const bucket = (name) => ({ id: `s3b:${name}`, kind: "bucket", label: name, bucket: name });
const object = (key) => ({ id: `s3o:b/${key}`, kind: "object", label: key, bucket: "b", key });
const types = (tree) => visibleRows(tree).map((r) => `${r.type}:${r.node.label}`);

test("nothing loads until a folder opens", () => {
  const tree = createTree(SERVICES);
  assert.deepEqual(types(tree), ["node:S3", "node:SSM Parameter Store"]);
  assert.equal(toggle(tree, "s3"), true);
  assert.equal(toggle(tree, "s3"), false);
});

test("overlapping loads are refused while one runs", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  const ticket = startLoad(tree, "s3");
  assert.ok(ticket);
  assert.equal(startLoad(tree, "s3"), null);
  assert.deepEqual(types(tree), ["node:S3", "loading:S3", "node:SSM Parameter Store"]);
  finishLoad(tree, "s3", ticket, { items: [bucket("b2"), bucket("a1")], nextToken: "t1" });
  assert.deepEqual(types(tree), ["node:S3", "node:a1", "node:b2", "more:S3", "node:SSM Parameter Store"]);
});

test("load more appends the next page and ends when the token runs out", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucket("a")], nextToken: "t1" });
  const more = startLoad(tree, "s3", { more: true });
  assert.equal(more.token, "t1");
  finishLoad(tree, "s3", more, { items: [bucket("b"), bucket("a")], nextToken: null });
  assert.deepEqual(types(tree), ["node:S3", "node:a", "node:b", "node:SSM Parameter Store"]);
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
  assert.deepEqual(types(tree), ["node:S3", "node:new", "node:SSM Parameter Store"]);
});

test("errors and empty folders show as rows; reopening retries", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "ssm");
  failLoad(tree, "ssm", startLoad(tree, "ssm"), "Access denied");
  assert.deepEqual(types(tree), ["node:S3", "node:SSM Parameter Store", "error:SSM Parameter Store"]);
  toggle(tree, "ssm");
  assert.equal(toggle(tree, "ssm"), true);
  finishLoad(tree, "ssm", startLoad(tree, "ssm"), { items: [], nextToken: null });
  assert.deepEqual(types(tree), ["node:S3", "node:SSM Parameter Store", "empty:SSM Parameter Store"]);
});

test("leaves do not toggle", () => {
  const tree = createTree(SERVICES);
  toggle(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [object("x")], nextToken: null });
  assert.equal(toggle(tree, "s3o:b/x"), false);
});
