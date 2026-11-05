// How the details pane shows a leaf's metadata. Pure, so node --test covers it.

/** [[label, value]] for an S3 object, SSM parameter, IAM resource, secret, Lambda function, ECR image, EC2 instance, EFS file system or EKS cluster; never a value or object content. */
export function detailFields(node) {
  const m = node?.meta ?? {};
  if (node?.kind === "object") return [
    ["Bucket", node.bucket], ["Key", node.key], ["Size", sizeWithBytes(m.size)], ["Last modified", formatDate(m.lastModified)],
    ["Storage class", m.storageClass ?? "STANDARD"], ["ETag", String(m.etag ?? "—").replaceAll('"', "")],
  ];
  if (node?.kind === "parameter") return [
    ["Name", node.name], ["Type", m.type ?? "—"], ["Version", m.version ?? "—"], ["Last modified", formatDate(m.lastModified)],
    ["Description", m.description || "—"], ["Tier", m.tier ?? "—"], ["Data type", m.dataType ?? "—"],
  ];
  if (node?.kind === "iam-user") return [
    ["Name", node.name], ["ARN", m.arn ?? "—"], ["User ID", m.id ?? "—"], ["Path", m.path ?? "—"],
    ["Created", formatDate(m.created)], ["Password last used", formatDate(m.passwordLastUsed)],
  ];
  if (node?.kind === "iam-role") return [
    ["Name", node.name], ["ARN", m.arn ?? "—"], ["Role ID", m.id ?? "—"], ["Path", m.path ?? "—"],
    ["Created", formatDate(m.created)], ["Description", m.description || "—"], ["Max session (s)", m.maxSessionDuration ?? "—"],
  ];
  if (node?.kind === "iam-group") return [
    ["Name", node.name], ["ARN", m.arn ?? "—"], ["Group ID", m.id ?? "—"], ["Path", m.path ?? "—"], ["Created", formatDate(m.created)],
  ];
  if (node?.kind === "iam-policy") return [
    ["Name", node.name], ["ARN", m.arn ?? "—"], ["Policy ID", m.id ?? "—"], ["Path", m.path ?? "—"],
    ["Created", formatDate(m.created)], ["Updated", formatDate(m.updated)], ["Attached to", m.attachmentCount ?? "—"],
    ["Default version", m.defaultVersion ?? "—"],
  ];
  if (node?.kind === "secret") return [
    ["Name", node.name], ["ARN", m.arn ?? "—"], ["Description", m.description || "—"], ["Last changed", formatDate(m.lastChanged)],
    ["Last accessed", formatDate(m.lastAccessed)], ["Created", formatDate(m.created)],
  ];
  if (node?.kind === "lambda-function") return [
    ["Name", node.name], ["Runtime", m.runtime ?? "—"], ["Memory", m.memory != null ? `${m.memory} MB` : "—"], ["Last modified", formatDate(m.lastModified)],
    ["ARN", m.arn ?? "—"],
  ];
  if (node?.kind === "ecr-image") return [
    ["Repository", node.repository], ["Tags", m.tags?.length ? m.tags.join(", ") : "(untagged)"], ["Pushed", formatDate(m.pushed)],
    ["Size", sizeWithBytes(m.size)], ["Digest", m.digest ?? "—"],
  ];
  if (node?.kind === "ec2-instance") return [
    ["Instance ID", m.id ?? "—"], ["Name", node.name === m.id ? "—" : node.name], ["State", m.state ?? "—"], ["Type", m.type ?? "—"],
    ["Zone", m.zone ?? "—"], ["Private IP", m.privateIp ?? "—"],
  ];
  if (node?.kind === "efs-filesystem") return [
    ["File system ID", m.id ?? "—"], ["Name", node.name === m.id ? "—" : node.name], ["Size", sizeWithBytes(m.size)],
    ["Performance mode", m.performanceMode ?? "—"], ["State", m.state ?? "—"],
  ];
  if (node?.kind === "eks-details") return [
    ["Cluster", node.name], ["Version", m.version ?? "—"], ["Status", m.status ?? "—"], ["Endpoint", m.endpoint ?? "—"], ["Created", formatDate(m.created)],
  ];
  return [];
}

export function formatSize(bytes) {
  if (typeof bytes !== "number" || !(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)} ${units[u]}`;
}

/** ISO timestamps from the CLI, shown as "YYYY-MM-DD HH:MM UTC" when they parse. */
export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function sizeWithBytes(bytes) {
  return typeof bytes === "number" ? `${formatSize(bytes)} (${bytes.toLocaleString("en-US")} bytes)` : "—";
}
