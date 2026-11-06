// The four lazy calls behind a bucket's details. node.details holds one text per finished call;
// a missing key means that call is still running. Pure, so node --test covers it.
import { getBucketOwnershipControls, getBucketVersioning, getBucketEncryption, getPublicAccessBlock } from "./aws-args.js";
import { hasDetails } from "./resources.js";
import { ownershipText, versioningText, encryptionText, publicAccessText } from "./parse.js";

export const DETAIL_CALLS = [
  { key: "ownership", command: getBucketOwnershipControls, parse: ownershipText },
  { key: "versioning", command: getBucketVersioning, parse: versioningText },
  { key: "encryption", command: getBucketEncryption, parse: encryptionText },
  { key: "publicAccess", command: getPublicAccessBlock, parse: publicAccessText },
];

/** True while the node's details were never requested (or a refresh dropped them). */
export function needsDetails(node) {
  return hasDetails(node) && !node.details;
}

/** The bucket node to load details for after a click or refresh: only the selected one, once. Else null. */
export function detailsToStart(tree, id) {
  const node = tree.nodes.get(id);
  return tree.selected === id && needsDetails(node) ? node : null;
}

/** Starts a round of calls; the returned object is the ticket for settleDetail. */
export function startDetails(node) {
  node.details = {};
  return node.details;
}

/** Stores one call's text; false when a refresh replaced the round meanwhile. */
export function settleDetail(node, details, key, text) {
  if (node.details !== details) return false;
  details[key] = text;
  return true;
}

export function detailText(node, key) {
  return node.details?.[key] ?? "Loading…";
}

/** Where a detail call runs: the bucket's own region, else the profile/base target's. */
export function detailTarget(node, target) {
  const region = node.meta?.region;
  return region ? { ...target, region } : target;
}
