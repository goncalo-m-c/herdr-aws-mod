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
