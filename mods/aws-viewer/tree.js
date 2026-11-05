// Lazy tree state: folders load on first open, one page at a time; stale results are dropped.
// Pure, so node --test covers it. A "ticket" ties a load to the request that started it.
import { isFolder, isGroupNode } from "./resources.js";

/** `regions` (optional): regional services get a "regions" node with one group per region. */
export function createTree(services, regions = []) {
  const tree = { nodes: new Map(), roots: [], selected: null };
  for (const spec of services) {
    tree.roots.push(spec.id);
    if (spec.folders && !(spec.regional && regions.length)) { addFixedFolders(tree, spec); continue; }
    if (!spec.regional || !regions.length) { tree.nodes.set(spec.id, makeNode(spec)); continue; }
    const groups = regions.map((region) => ({ ...spec, id: `${spec.id}@${region}`, label: region, region }));
    for (const group of groups) {
      if (group.folders) addFixedFolders(tree, group); // a region group with fixed folders (CloudWatch)
      else tree.nodes.set(group.id, makeNode(group));
    }
    tree.nodes.set(spec.id, { ...makeNode({ id: spec.id, kind: "regions", label: spec.label }), loaded: true, children: groups.map((g) => g.id) });
  }
  return tree;
}

// A service (or one region group) with fixed folders: the root is already loaded, each folder loads its own list.
function addFixedFolders(tree, spec) {
  const { folders, ...root } = spec;
  const children = folders.map((folder) => makeNode({ ...folder, id: `${spec.id}:${folder.kind}`, ...(spec.region ? { region: spec.region } : {}) }));
  for (const child of children) tree.nodes.set(child.id, child);
  tree.nodes.set(spec.id, { ...makeNode(root), group: true, loaded: true, children: children.map((c) => c.id) });
}

/** Opens or closes a folder; returns true when it now needs its first page. */
export function toggle(tree, id) {
  const node = tree.nodes.get(id);
  if (!node || !isFolder(node)) return false;
  node.open = !node.open;
  return node.open && !node.loaded && !node.loading;
}

/** A ticket for the next load, or null while one runs (the overlap guard) or with no next page. */
export function startLoad(tree, id, { more = false } = {}) {
  const node = tree.nodes.get(id);
  if (!node || node.loading || (more && !node.nextToken)) return null;
  node.loading = true;
  node.error = null;
  node.request += 1;
  return { request: node.request, token: more ? node.nextToken : null, more };
}

/** Applies a page; returns false when the ticket is stale (a refresh started since). */
export function finishLoad(tree, id, ticket, page) {
  const node = current(tree, id, ticket);
  if (!node) return false;
  if (!ticket.more) dropChildren(tree, node);
  for (const raw of page.items) {
    const item = node.region ? { ...raw, id: `${raw.id}@${node.region}`, region: node.region } : raw; // same name, other region: own node
    if (!tree.nodes.has(item.id)) tree.nodes.set(item.id, makeNode(item));
    if (!node.children.includes(item.id)) node.children.push(item.id);
  }
  node.children.sort((a, b) => compareItems(tree.nodes.get(a), tree.nodes.get(b)));
  Object.assign(node, { loading: false, loaded: true, nextToken: page.nextToken ?? null });
  return true;
}

export function failLoad(tree, id, ticket, message) {
  const node = current(tree, id, ticket);
  if (!node) return false;
  Object.assign(node, { loading: false, error: message });
  return true;
}

/** Forgets a folder's pages and opens it; any load in flight for it becomes stale. */
export function refresh(tree, id) {
  const node = tree.nodes.get(id);
  if (!node || !isFolder(node) || isGroupNode(node)) return false;
  dropChildren(tree, node);
  Object.assign(node, { open: true, loaded: false, loading: false, error: null, nextToken: null, request: node.request + 1 });
  return true;
}

export function select(tree, id) {
  tree.selected = tree.nodes.has(id) ? id : null;
}

/** Rows to draw, in order: { type: "node" | "loading" | "error" | "more" | "empty", node, depth }. */
export function visibleRows(tree) {
  const rows = [];
  addRows(tree, tree.roots, 0, rows);
  return rows;
}

function addRows(tree, ids, depth, rows) {
  for (const id of ids) {
    const node = tree.nodes.get(id);
    rows.push({ type: "node", node, depth });
    if (isFolder(node) && node.open) addFolderBody(tree, node, depth + 1, rows);
  }
}

function addFolderBody(tree, node, depth, rows) {
  addRows(tree, node.children, depth, rows);
  if (node.loading) rows.push({ type: "loading", node, depth });
  else if (node.error) rows.push({ type: "error", node, depth });
  if (!node.loading && node.nextToken) rows.push({ type: "more", node, depth });
  if (node.loaded && !node.loading && !node.error && !node.children.length) rows.push({ type: "empty", node, depth });
}

function current(tree, id, ticket) {
  const node = tree.nodes.get(id);
  return node && node.request === ticket.request ? node : null;
}

function dropChildren(tree, node) {
  for (const id of node.children) {
    const child = tree.nodes.get(id);
    if (child) dropChildren(tree, child);
    tree.nodes.delete(id);
    if (tree.selected === id) tree.selected = null;
  }
  node.children = [];
}

// Folders first, then by name.
function compareItems(a, b) {
  const folder = Number(isFolder(b)) - Number(isFolder(a));
  if (folder) return folder;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

function makeNode(spec) {
  return { ...spec, open: false, loaded: false, loading: false, error: null, children: [], nextToken: null, request: 0 };
}
