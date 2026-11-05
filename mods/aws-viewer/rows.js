// Draws the tree's rows: folders, leaves, and the loading / error / empty / "Load more" rows.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { isFolder, isGroupNode } from "./resources.js";

const ROW_HEIGHT = 26;
const INDENT = 16;
const ICONS = { s3: "cloud", regions: "cloud", ssm: "cloud", iam: "cloud", lambda: "cloud", ecr: "cloud", "ecr-repo": "folder", "ecr-image": "file", "lambda-function": "file", secrets: "cloud", secret: "key", "iam-users": "folder", "iam-roles": "folder", "iam-groups": "folder", "iam-policies": "folder", bucket: "bucket", prefix: "folder", "ssm-path": "folder", object: "file", parameter: "key" };
const EMPTY = { s3: "No buckets", bucket: "Empty bucket", prefix: "Empty folder", ssm: "No parameters", "ssm-path": "No parameters",
  "iam-users": "No users", "iam-roles": "No roles", "iam-groups": "No groups", "iam-policies": "No local policies", secrets: "No secrets", lambda: "No functions", ecr: "No repositories", "ecr-repo": "No images" };

/** `actions`: { activate(id, cx), refresh(id, cx), more(id, cx) }. */
export function treeRow(row, selected, t, actions) {
  if (row.type === "node") return nodeRow(row, selected, t, actions);
  if (row.type === "more") return moreRow(row, t, actions);
  return hintRow(row, t);
}

function nodeRow({ node, depth }, selected, t, actions) {
  const folder = isFolder(node);
  return h_flex().id(`row-${node.id}`).h(ROW_HEIGHT).flex_none().pr(4).gap(4).items_center().rounded(6)
    .bg(selected ? t.selected : t.background).hover((s) => s.bg(selected ? t.selected : t.hover))
    .child(h_flex().id(`open-${node.id}`).flex_1().min_w(0).h_full().pl(8 + depth * INDENT).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => actions.activate(node.id, cx))
      .child(folder ? svg(`mods/aws-viewer/chevron-${node.open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(`mods/aws-viewer/${ICONS[node.kind] ?? "file"}.svg`).size(14).flex_none().text_color(depth === 0 ? t.accent : t.muted))
      .child(div().id(`label-${node.id}`).flex_1().min_w(0).truncate().tooltip(fullName(node)).child(node.label || "(empty name)")))
    .when(node.loading, (el) => el.child(svg("mods/aws-viewer/spinner.svg").size(12).flex_none().text_color(t.dim).spin(900)))
    .when(folder && !isGroupNode(node) && !node.loading && (node.loaded || Boolean(node.error)), (el) => el.child(refreshButton(node, t, actions)));
}

function refreshButton(node, t, actions) {
  return div().id(`refresh-${node.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
    .text_color(t.dim).hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip("Refresh this node")
    .on_click((_e, cx) => actions.refresh(node.id, cx))
    .child(svg("mods/aws-viewer/refresh.svg").size(12));
}

function moreRow({ node, depth }, t, actions) {
  return h_flex().id(`more-${node.id}`).h(ROW_HEIGHT).flex_none().pl(8 + depth * INDENT + 18).items_center().rounded(6).cursor_pointer()
    .text_size(12).text_color(t.accent).hover((s) => s.bg(t.hover)).on_click((_e, cx) => actions.more(node.id, cx))
    .child("Load more…");
}

function hintRow({ type, node, depth }, t) {
  const color = type === "error" ? t.ansi1 : t.dim;
  const text = type === "loading" ? "Loading…" : type === "error" ? node.error : EMPTY[node.kind] ?? "Empty";
  return h_flex().id(`${type}-${node.id}`).h(ROW_HEIGHT).flex_none().pl(8 + depth * INDENT + 18).pr(8).gap(6).items_center()
    .text_size(12).text_color(color)
    .when(type === "loading", (el) => el.child(svg("mods/aws-viewer/spinner.svg").size(11).flex_none().spin(900)))
    .child(div().id(`${type}-text-${node.id}`).flex_1().min_w(0).truncate().tooltip(text).child(text));
}

function fullName(node) {
  if (node.kind === "object") return `s3://${node.bucket}/${node.key}`;
  if (node.kind === "prefix") return `s3://${node.bucket}/${node.prefix}`;
  if (node.kind === "bucket") return `s3://${node.bucket}`;
  return node.name ?? node.path ?? node.label;
}
