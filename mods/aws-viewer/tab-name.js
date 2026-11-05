// Names the viewer's own tab after the AWS profile, unless someone named it by hand.
import { spaces, panes, run } from "herdr";

/** The tab being shown that holds an aws-viewer pane: a mod starts when first shown, so it is ours. */
export function shownViewerTabId() {
  const shownTabs = spaces().filter((space) => space.active).flatMap((space) => space.tabs.filter((tab) => tab.active));
  const holdsViewer = (tab) => panes().some((pane) => pane.tab === tab.id && pane.mod === "aws-viewer");
  return shownTabs.find(holdsViewer)?.id ?? null;
}

/** Renames the tab and returns the name we set, so a later call can tell it from a hand-made one. */
export function nameTabAfterProfile(tabId, profile, lastAutoName) {
  const tab = spaces().flatMap((space) => space.tabs).find((candidate) => candidate.id === tabId);
  const namedByHand = tab?.named && tab.name !== lastAutoName;
  if (!tab || !profile || namedByHand || tab.name === profile) return lastAutoName;
  run("tab.rename", { id: tabId, name: profile });
  return profile;
}
