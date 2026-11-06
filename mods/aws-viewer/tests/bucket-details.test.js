import { test } from "node:test";
import assert from "node:assert/strict";
import { detailFields } from "../format.js";
import { DETAIL_CALLS, detailTarget, detailsToStart, needsDetails, startDetails, settleDetail } from "../bucket-details.js";
import { createTree, activate, finishLoad, refresh, startLoad } from "../tree.js";
import { SERVICES } from "../resources.js";

const bucketItem = { id: "s3b:b", kind: "bucket", label: "b", bucket: "b", meta: { created: "2024-05-01T08:30:00+00:00", region: "eu-west-1" } };
const value = (node, label) => detailFields(node).find(([l]) => l === label)[1];

function treeWithBucket() {
  const tree = createTree(SERVICES);
  activate(tree, "s3");
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucketItem], nextToken: null });
  return tree;
}

test("bucket shows the 7 fields in order; the first three need no call", () => {
  const fields = detailFields({ ...bucketItem });
  assert.deepEqual(fields.map(([l]) => l), ["Name", "Region", "Created", "Object Ownership", "Versioning", "Encryption", "Block Public Access"]);
  assert.deepEqual(fields.slice(0, 3).map(([, v]) => v), ["b", "eu-west-1", "2024-05-01 08:30 UTC"]);
});

test("pending fields show Loading… and settle one by one", () => {
  const node = { ...bucketItem };
  const details = startDetails(node);
  assert.deepEqual(detailFields(node).slice(3).map(([, v]) => v), Array(4).fill("Loading…"));
  settleDetail(node, details, "versioning", "Enabled");
  settleDetail(node, details, "encryption", "No access");
  assert.equal(value(node, "Versioning"), "Enabled");
  assert.equal(value(node, "Encryption"), "No access");
  assert.equal(value(node, "Block Public Access"), "Loading…");
});

test("refresh drops the cache so the four calls run again; a stale round is ignored", () => {
  const tree = treeWithBucket();
  const node = tree.nodes.get("s3b:b");
  const old = startDetails(node);
  refresh(tree, "s3b:b");
  assert.equal(needsDetails(node), true);
  assert.equal(settleDetail(node, old, "ownership", "late"), false);
  assert.equal(DETAIL_CALLS.length, 4);
});

test("clicking a bucket opens and selects it; a folder without details only toggles", () => {
  const tree = treeWithBucket();
  assert.equal(activate(tree, "s3b:b"), true);
  assert.equal(tree.nodes.get("s3b:b").open, true);
  assert.equal(tree.selected, "s3b:b");
  assert.equal(activate(tree, "s3"), false);
  assert.equal(tree.selected, "s3b:b");
  assert.equal(tree.nodes.get("s3").open, false);
});

test("clicking a leaf still selects it", () => {
  const tree = createTree(SERVICES);
  activate(tree, "s3");
  const leaf = { id: "s3o:b/k", kind: "object", label: "k", bucket: "b", key: "k" };
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [leaf], nextToken: null });
  activate(tree, "s3o:b/k");
  assert.equal(tree.selected, "s3o:b/k");
});

// The click path as main.js runs it: activate the node, then ask whether details start.
function click(tree, id) {
  activate(tree, id);
  const node = detailsToStart(tree, id);
  if (node) startDetails(node);
  return node ? DETAIL_CALLS.length : 0;
}

test("opening the S3 list starts no detail calls", () => {
  const tree = createTree(SERVICES);
  assert.equal(click(tree, "s3"), 0);
  finishLoad(tree, "s3", startLoad(tree, "s3"), { items: [bucketItem], nextToken: null });
  assert.equal(tree.nodes.get("s3b:b").details, null);
});

test("the first bucket click starts the 4 calls; a second click starts none and keeps the cached values", () => {
  const tree = treeWithBucket();
  const node = tree.nodes.get("s3b:b");
  assert.equal(click(tree, "s3b:b"), 4);
  settleDetail(node, node.details, "versioning", "Enabled");
  assert.equal(click(tree, "s3b:b"), 0);
  assert.equal(value(node, "Versioning"), "Enabled");
});

test("refreshing an unselected bucket starts no calls; the selected one starts them again", () => {
  const tree = treeWithBucket();
  const node = tree.nodes.get("s3b:b");
  click(tree, "s3b:b");
  tree.selected = "s3";
  refresh(tree, "s3b:b");
  assert.equal(node.details, null);
  assert.equal(detailsToStart(tree, "s3b:b"), null);
  tree.selected = "s3b:b";
  assert.equal(detailsToStart(tree, "s3b:b"), node);
});

test("detail calls run in the bucket's region, else in the profile's", () => {
  const target = { profile: "dev", region: "us-east-1" };
  assert.deepEqual(detailTarget({ meta: { region: "eu-west-1" } }, target), { profile: "dev", region: "eu-west-1" });
  assert.equal(detailTarget({ meta: {} }, target), target);
  assert.equal(detailTarget({}, target), target);
});
