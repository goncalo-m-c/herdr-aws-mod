# aws-viewer (prototype)

A read-only AWS resource viewer laid out like a file browser. It covers S3 and SSM Parameter Store only.

## What it does

- The root lists two services: **S3** and **SSM Parameter Store**. Nothing loads until you open a node.
- **S3**: opening it lists buckets. Opening a bucket or prefix lists one level: prefixes are folders, objects are leaves.
- **SSM**: opening it lists the parameter hierarchy. `/app/env/...` segments are folders, parameters are leaves.
- Each folder loads 50 items per page. A **Load more…** row appears while a next token exists.
- Selecting a leaf opens a read-only details pane with metadata:
  - S3 object: bucket, key, size, last modified, storage class, ETag.
  - SSM parameter: name, type, version, last modified, description, tier, data type.
- Each loaded folder has a refresh button. The header button reads `AWS_PROFILE` again and resets the tree.
- Loading, empty and error states show inline in the tree. Errors include expired login, access denied and a missing CLI.

## Profile and region

- The profile comes from `AWS_PROFILE`, read from your login shell (`$SHELL -lc`). Herdr's own environment may lack it.
- The region comes from `AWS_REGION`, else `AWS_DEFAULT_REGION`. If neither is set, the profile's config region applies.
- Props override both: `{"profile": "dev", "region": "eu-west-1"}`.

## The aws commands it runs

Every call gets `--profile=<p> [--region=<r>] --output=json --no-cli-pager --no-cli-auto-prompt`.

| Node | Command |
|---|---|
| S3 | `aws s3api list-buckets --no-paginate --max-buckets=50 [--continuation-token=T]` |
| Bucket / prefix | `aws s3api list-objects-v2 --no-paginate --bucket=B [--prefix=P] --delimiter=/ --max-keys=50 [--continuation-token=T]` |
| SSM root | `aws ssm describe-parameters --no-paginate --max-results=50 [--next-token=T]` |
| SSM folder | same, plus `--parameter-filters=[{"Key":"Path","Option":"Recursive","Values":["/app"]}]` |
| Header region | `aws configure get region` (a local read of `~/.aws/config`) |

`--no-paginate` with the native page size and token makes exactly one API call per page. The CLI's `--max-items` counts only `Contents`. On a prefix-only bucket level, `--max-items` would therefore walk every page.

Selecting a leaf makes no call. The details come from the listing.

## Safety

All `aws` calls go through `aws.js` → `invocation()` in `aws-args.js`. That function checks these rules before any argv exists:

1. **Read-only allowlist.** Only `s3api list-buckets`, `s3api list-objects-v2`, `ssm describe-parameters` and `configure get` pass. The viewer refuses any argument that contains `decryption`.
2. **Value safety.** Values use the `--flag=value` form, so a name that starts with `-` is never read as a flag. The viewer refuses resource names that look like `file://` or other URLs. The CLI would read those from disk.
3. **Region format.** The region must look like `xx-name-N`.

The viewer never reads or shows parameter values. It never downloads object contents and never writes to AWS. Output stays in memory. Nothing goes to files or to `console.log`.

## Open it

```sh
herdr-app do tab.new --name aws --mod aws-viewer --props '{}'
```

## Tests

The pure modules have unit tests. Run them in Docker, with no network:

```sh
docker run --rm --network none -v ~/.config/herdr-app/mods/aws-viewer:/w:ro -w /w node:22-slim node --test
```

## Limitations

- This is a prototype. The author has only lightly tested it against real accounts.
- SSM has no API that lists folders. Folders come from the parameters each page returns. A "Load more" may only add new folders.
- SSM root and folder pages list all descendants recursively. The viewer groups them by the next path segment.
- `$SHELL -lc` does not read `.zshrc`. Set `AWS_PROFILE` in `.zshenv` or `.zprofile`, or pass it as a prop.
- Buckets in other regions rely on the CLI's S3 region redirect.
- The tree has no keyboard navigation and no search.
