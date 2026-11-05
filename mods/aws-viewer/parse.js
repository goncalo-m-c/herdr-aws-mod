// Turns one page of aws CLI JSON into tree items and the next page token.
// Pure, so node --test covers it. Items carry metadata only, never object contents or parameter values.

/** s3api list-buckets */
export function bucketsPage(json) {
  const items = (json?.Buckets ?? []).map((b) => ({
    id: `s3b:${b.Name}`, kind: "bucket", label: b.Name, bucket: b.Name,
    meta: { created: b.CreationDate ?? null, region: b.BucketRegion ?? null },
  }));
  return { items, nextToken: json?.ContinuationToken ?? null };
}

/** s3api list-objects-v2 with --delimiter "/": prefixes are folders, objects are leaves. */
export function objectsPage(json, bucket, prefix) {
  const folders = (json?.CommonPrefixes ?? []).map((p) => ({
    id: `s3p:${bucket}/${p.Prefix}`, kind: "prefix", label: withoutTrailingSlash(p.Prefix.slice(prefix.length)), bucket, prefix: p.Prefix,
  }));
  const objects = (json?.Contents ?? []).filter((o) => o.Key !== prefix).map((o) => ({
    id: `s3o:${bucket}/${o.Key}`, kind: "object", label: o.Key.slice(prefix.length), bucket, key: o.Key,
    meta: { size: o.Size ?? null, lastModified: o.LastModified ?? null, storageClass: o.StorageClass ?? null, etag: o.ETag ?? null },
  }));
  return { items: [...folders, ...objects], nextToken: json?.IsTruncated ? json.NextContinuationToken ?? null : null };
}

/** ssm describe-parameters under `path` ("" = all): the next path segment becomes a folder. */
export function parametersPage(json, path) {
  const items = new Map();
  for (const parameter of json?.Parameters ?? []) {
    const item = parameterItem(parameter, path);
    if (item && !items.has(item.id)) items.set(item.id, item);
  }
  return { items: [...items.values()], nextToken: json?.NextToken ?? null };
}

function parameterItem(parameter, path) {
  const name = String(parameter.Name ?? "");
  if (path && !name.startsWith(`${path}/`)) return null;
  const rest = path ? name.slice(path.length + 1) : name.replace(/^\//, "");
  if (!rest) return null;
  const [first, ...deeper] = rest.split("/");
  if (deeper.length) {
    const folder = `${path || ""}/${first}`;
    return { id: `ssm:${folder}`, kind: "ssm-path", label: first, path: folder };
  }
  return {
    id: `ssmp:${name}`, kind: "parameter", label: rest, name,
    meta: {
      type: parameter.Type ?? null, version: parameter.Version ?? null, lastModified: parameter.LastModifiedDate ?? null,
      description: parameter.Description ?? null, tier: parameter.Tier ?? null, dataType: parameter.DataType ?? null,
    },
  };
}

function withoutTrailingSlash(text) {
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

/** iam list-users */
export function usersPage(json) {
  const items = (json?.Users ?? []).map((u) => ({
    id: `iamu:${u.UserName}`, kind: "iam-user", label: u.UserName, name: u.UserName,
    meta: { arn: u.Arn ?? null, id: u.UserId ?? null, path: u.Path ?? null, created: u.CreateDate ?? null, passwordLastUsed: u.PasswordLastUsed ?? null },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}

/** iam list-roles */
export function rolesPage(json) {
  const items = (json?.Roles ?? []).map((r) => ({
    id: `iamr:${r.RoleName}`, kind: "iam-role", label: r.RoleName, name: r.RoleName,
    meta: { arn: r.Arn ?? null, id: r.RoleId ?? null, path: r.Path ?? null, created: r.CreateDate ?? null, description: r.Description ?? null, maxSessionDuration: r.MaxSessionDuration ?? null },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}

/** iam list-groups */
export function groupsPage(json) {
  const items = (json?.Groups ?? []).map((g) => ({
    id: `iamg:${g.GroupName}`, kind: "iam-group", label: g.GroupName, name: g.GroupName,
    meta: { arn: g.Arn ?? null, id: g.GroupId ?? null, path: g.Path ?? null, created: g.CreateDate ?? null },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}

/** iam list-policies --scope Local */
export function policiesPage(json) {
  const items = (json?.Policies ?? []).map((p) => ({
    id: `iamp:${p.PolicyName}`, kind: "iam-policy", label: p.PolicyName, name: p.PolicyName,
    meta: {
      arn: p.Arn ?? null, id: p.PolicyId ?? null, path: p.Path ?? null, created: p.CreateDate ?? null, updated: p.UpdateDate ?? null,
      attachmentCount: p.AttachmentCount ?? null, defaultVersion: p.DefaultVersionId ?? null,
    },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}

/** lambda list-functions: configuration metadata only, never code. */
export function functionsPage(json) {
  const items = (json?.Functions ?? []).map((f) => ({
    id: `lambda:${f.FunctionName}`, kind: "lambda-function", label: f.FunctionName, name: f.FunctionName,
    meta: { arn: f.FunctionArn ?? null, runtime: f.Runtime ?? f.PackageType ?? null, memory: f.MemorySize ?? null, lastModified: f.LastModified ?? null },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}

/** secretsmanager list-secrets: metadata only, never the secret value. */
export function secretsPage(json) {
  const items = (json?.SecretList ?? []).map((s) => ({
    id: `sm:${s.Name}`, kind: "secret", label: s.Name, name: s.Name,
    meta: { arn: s.ARN ?? null, description: s.Description ?? null, lastChanged: s.LastChangedDate ?? null, lastAccessed: s.LastAccessedDate ?? null, created: s.CreatedDate ?? null },
  }));
  return { items, nextToken: json?.NextToken ?? null };
}
