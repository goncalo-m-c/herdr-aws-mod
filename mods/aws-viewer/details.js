// The read-only details pane for the selected S3 object or SSM parameter: metadata only.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { detailFields } from "./format.js";

const NOTES = {
  object: "Metadata from the bucket listing. Object contents are never downloaded.",
  parameter: "Metadata from describe-parameters. Parameter values are never read or shown.",
  secret: "Metadata from list-secrets. Secret values are never read or shown.",
  "lambda-function": "Metadata from lambda list-functions. Function code is never downloaded.",
  "ecr-image": "Metadata from ecr describe-images. Image contents are never pulled.",
  "ec2-instance": "Metadata from ec2 describe-instances. User data, other tags and console output are never read.",
  "efs-filesystem": "Metadata from efs describe-file-systems. File contents are never read.",
  "eks-details": "Metadata from eks describe-cluster. Certificate data and credentials are never read.",
  "iam-user": "Metadata from iam list-users.",
  "iam-role": "Metadata from iam list-roles.",
  "iam-group": "Metadata from iam list-groups.",
  "iam-policy": "Metadata from iam list-policies --scope Local.",
};

export function detailsPane(node, t) {
  return v_flex().id("aws-details").size_full().min_h(0).overflow_y_scrollbar().p(12).gap(10).text_size(12)
    .child(div().id("aws-details-title").font_semibold().text_size(13).truncate().tooltip(node.name ?? node.key ?? node.label).child(node.label))
    .children(detailFields(node).map(([label, value], i) => field(i, label, value, t)))
    .child(div().pt(4).text_size(11).text_color(t.dim).child(NOTES[node.kind] ?? ""));
}

function field(i, label, value, t) {
  return h_flex().id(`aws-field-${i}`).gap(10).items_start()
    .child(div().w(96).flex_none().text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).text_color(t.foreground).child(String(value ?? "—")));
}
