// Herdr Browser for AWS: S3 and SSM Parameter Store as a lazy, paged, read-only tree.
// Every aws call is built in aws-args.js; SSM shows metadata, never values.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme } from "herdr";
import { nameTabAfterProfile, shownViewerTabId } from "./tab-name.js";
import { needsShellEnv, resolveTarget } from "./context.js";
import { loginShellEnv } from "./env.js";
import { regionList } from "./aws-args.js";
import { runAws, profileRegion } from "./aws.js";
import { SERVICES, isFolder, pageCommand, parsePage } from "./resources.js";
import { createTree, toggle, startLoad, finishLoad, failLoad, refresh, select, visibleRows } from "./tree.js";
import { treeRow } from "./rows.js";
import { detailsPane } from "./details.js";

const STACK_BELOW = 640;
const DETAILS_WIDTH = 320;
const TAB_CLAIM_MS = 5000;

export default class AwsViewer extends View {
  init(_props, cx) {
    this.size = { width: 900, height: 600 };
    this.actions = {
      activate: (id, cx) => this.activate(id, cx),
      refresh: (id, cx) => this.refreshNode(id, cx),
      more: (id, cx) => this.load(id, true, cx),
    };
    this.tabId = null;
    this.startSession(cx);
  }

  // A session: one profile/region and one tree. Starting again drops the old one's results.
  startSession(cx) {
    const session = this.session = {};
    this.tree = createTree(SERVICES);
    this.target = null;
    this.shownRegion = "";
    this.regionsError = "";
    this.tabClaimUntil = Date.now() + TAB_CLAIM_MS;
    this.tabNamed = false;
    cx.spawn(async (cx) => {
      const given = props() ?? {};
      const shell = needsShellEnv(given) ? await loginShellEnv() : {};
      if (this.session !== session) return;
      this.target = resolveTarget(given, shell);
      this.useRegions(given.regions);
      this.shownRegion = this.target.region;
      this.nameTab();
      cx.notify();
      if (!this.target.region) this.lookupRegion(session, cx);
    });
  }

  // The `regions` prop picks the tree's groups; a bad one shows an error and an empty tree.
  useRegions(regions) {
    try { this.tree = createTree(SERVICES, regionList(regions)); this.regionsError = ""; }
    catch (e) { this.tree = createTree([]); this.regionsError = e.message; }
  }

  // Retried on render for a few seconds: Herdr may not list our pane yet when we start.
  nameTab() {
    if (this.tabNamed || !this.target || Date.now() > this.tabClaimUntil) return;
    this.tabId ??= shownViewerTabId();
    if (!this.tabId) return;
    this.autoTabName = nameTabAfterProfile(this.tabId, this.target.profile, this.autoTabName);
    this.tabNamed = true;
  }

  lookupRegion(session, cx) {
    cx.spawn(async (cx) => {
      const region = await profileRegion(this.target);
      if (this.session !== session) return;
      this.shownRegion = region;
      cx.notify();
    });
  }

  activate(id, cx) {
    const node = this.tree.nodes.get(id);
    if (isFolder(node)) { if (toggle(this.tree, id)) this.load(id, false, cx); }
    else select(this.tree, id);
    cx.notify();
  }

  refreshNode(id, cx) {
    if (refresh(this.tree, id)) this.load(id, false, cx);
    cx.notify();
  }

  // One page into a folder. startLoad returns null while a load runs: the overlap guard.
  load(id, more, cx) {
    const tree = this.tree, session = this.session, node = tree.nodes.get(id);
    const ticket = startLoad(tree, id, { more });
    if (!ticket) return;
    cx.spawn(async (cx) => {
      try {
        if (!this.target) throw new Error("Still reading AWS_PROFILE. Refresh in a moment.");
        const json = await runAws(pageCommand(node, ticket.token), node.region ? { ...this.target, region: node.region } : this.target);
        if (this.session === session) finishLoad(tree, id, ticket, parsePage(node, json));
      } catch (e) {
        if (this.session === session) failLoad(tree, id, ticket, String(e?.message ?? e));
      } finally { cx.notify(); }
    });
    cx.notify();
  }

  render() {
    this.nameTab();
    const t = theme();
    const selected = this.tree.selected ? this.tree.nodes.get(this.tree.selected) : null;
    const stacked = this.size.width < STACK_BELOW;
    return v_flex().id("aws-viewer").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.header(t))
      .child((stacked ? v_flex() : h_flex()).flex_1().min_h(0)
        .child(this.treePane(t, selected))
        .when(Boolean(selected), (el) => el.child(this.detailsFrame(t, selected, stacked))));
  }

  header(t) {
    const target = this.target;
    const profileColor = target ? t.ansi2 : t.dim;
    return h_flex().h(42).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/aws-viewer/cloud.svg").size(20).flex_none().text_color(t.muted))
      .child(div().id("aws-profile").min_w(0).flex_shrink(1).truncate().text_size(12).text_color(profileColor)
        .tooltip(target?.profileSource === "props" ? "Profile from props" : "Profile from AWS_PROFILE (login shell)")
        .child(target ? `profile ${target.profile || "(none)"}` : "Reading AWS_PROFILE…"))
      .child(this.regionsError
        ? div().min_w(0).flex_shrink(1).truncate().text_size(12).text_color(t.ansi1).child(this.regionsError)
        : div().flex_none().text_size(12).text_color(t.dim).child(target ? `region ${this.shownRegion || "(profile default)"}` : ""))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(t.dim).child("read-only"))
      .child(div().id("aws-reload").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Read AWS_PROFILE again and reset the tree")
        .on_click((_e, cx) => { this.startSession(cx); cx.notify(); })
        .child(svg("mods/aws-viewer/refresh.svg").size(14)));
  }

  treePane(t, selected) {
    return v_flex().id("aws-tree").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(6)
      .children(visibleRows(this.tree).map((row) => treeRow(row, row.node === selected, t, this.actions)));
  }

  detailsFrame(t, selected, stacked) {
    const frame = stacked ? div().h(240).w_full().border_t(1) : div().w(DETAILS_WIDTH).h_full().border_l(1);
    return frame.flex_none().min_h(0).border_color(t.border).bg(t.background).child(detailsPane(selected, t));
  }
}
