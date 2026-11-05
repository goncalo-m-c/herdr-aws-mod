# AWS Viewer

A read-only browser for your AWS account, in a Herdr tab. A header shows the profile and region. Below it, a tree lists S3 buckets and SSM Parameter Store parameters. Selecting an item opens its metadata at the right.

![AWS Viewer](preview.png)

## What you see

The mod is one pane, 900 by 600 at first, in the theme's background and foreground colors. Text is 13px.

- **Header, 42px high**, with a bottom border. Left to right:
  - A neutral cloud icon (`cloud.svg`, 20px, muted color).
  - `profile <name>` in 12px. Green (`ansi2`), dim while reading.
  - `region <name>` in 12px dim. It shows `(profile default)` when no region is known.
  - A spacer, then `read-only` in 11px dim.
  - A 26px reload button with the refresh icon.
- **Tree, left.** Rows are 26px high. Each level indents 16px.
  - Two roots: `S3` and `SSM Parameter Store`, with an accent-colored cloud icon.
  - Folders show a chevron (right or down) and a folder or bucket icon. Leaves show a file or key icon.
  - A spinner shows while a folder loads. A refresh button shows on loaded folders.
  - Hint rows: `Loading…`, the error text in red, and `No buckets`, `Empty bucket`, `Empty folder` or `No parameters`.
  - A `Load more…` row in the accent color appears while a next page exists.
- **Details pane, right,** 320px wide with a left border. It appears only when a leaf is selected.
  - S3 object: bucket, key, size, last modified, storage class, ETag.
  - SSM parameter: name, type, version, last modified, description, tier, data type.
  - A note: object contents and parameter values are never read.
  - Below 640px width, the details pane moves under the tree, 240px high.

## How it behaves

- **Start.** The mod reads `AWS_PROFILE` and the region from props, or from your login shell. Nothing loads until you open a node.
- **Click a folder row.** It opens or closes. The first open loads one page of 50 items.
- **Click a leaf.** It selects the leaf and shows details. This makes no AWS call.
- **Load more.** It loads the next page of 50 with the continuation token.
- **Refresh button on a folder.** It reloads that folder.
- **Header reload button.** It reads `AWS_PROFILE` again, drops the old tree and starts over.
- **Hover.** Rows and buttons get the theme's hover background. Long names show a tooltip with the full name, such as `s3://my-bucket/reports/`.
- **Errors.** They show inline in the tree: expired login, no credentials, unknown profile, access denied, missing bucket, no network, missing AWS CLI.
- **Tab name.** For about 5 seconds after start, the mod renames its own tab to the profile name. It does nothing if you named the tab yourself.
- **Refused profile.** The header turns red, the banner shows, and the mod runs no `aws` command.
- There are no agent statuses. The mod does not look at agents.

## Built from

Mod `mods/aws-viewer/` with `mod.json` = `{"place":"none"}`. It takes optional props `profile` and `region`. It uses `View`, `div` and `svg` from `gpui-kit`, `v_flex` and `h_flex` from `gpui-base`, and `props`, `theme`, `exec`, `spaces`, `panes` and `run` from `herdr`.

Modules, each small and pure unless noted:

- `main.js`: the view, header, banner and layout. It starts sessions and loads pages.
- `aws-args.js`: builds every `aws` argv, with a read-only allowlist, `--flag=value` form, URL-like name refusal and region format check.
- `aws.js`: **the only file that runs `aws`** (`exec("aws", argv)`). It also reads the profile region with `aws configure get region`.
- `env.js`: the only other `exec`. It runs one `sh -c` login-shell call to read `AWS_PROFILE`, `AWS_REGION` and `AWS_DEFAULT_REGION`.
- `context.js`: picks profile and region, props first, then the shell values.
- `resources.js`: maps each node kind to its `aws` command and its parser.
- `parse.js`: turns CLI JSON into tree items. SSM folders come from the parameter names.
- `tree.js`: lazy tree state, paging tickets, and the overlap guard.
- `rows.js`: draws tree rows and hint rows.
- `details.js` and `format.js`: the details pane and its text formatting.
- `errors.js`: short messages for failed `aws` calls.
- `tab-name.js`: renames the viewer's tab with `run("tab.rename", ...)`.
- `tests/` with fake JSON fixtures: unit tests for the pure modules, run with `node --test`.

`aws` commands, always with `--profile=<p> [--region=<r>] --output=json --no-cli-pager --no-cli-auto-prompt`:

- `s3api list-buckets --no-paginate --max-buckets=50`
- `s3api list-objects-v2 --no-paginate --bucket=… --delimiter=/ --max-keys=50`
- `ssm describe-parameters --no-paginate --max-results=50`, with a `Path` Recursive filter for folders
- `configure get region`

Art: `cloud.svg`, `bucket.svg`, `folder.svg`, `file.svg`, `key.svg`, `chevron-right.svg`, `chevron-down.svg`, `refresh.svg`, `spinner.svg` (24px stroke icons, tinted with `text_color`).

## Watch out

- No live AWS call was verified in CI. Tests cover only the pure modules, with fixtures.
- The viewer blocks any argument that contains `decryption`, and any resource name that looks like `file://` or another URL.
- The environment lookup uses a login shell (`$SHELL -lc`). `zsh -l` does not read `.zshrc`. Set `AWS_PROFILE` in `.zshenv` or `.zprofile`, or pass `profile` as a prop.
- Use `--no-paginate` with the native page size and token. `--max-items` can walk every page on a prefix-only level.
- SSM has no folder API. A "Load more" may add only new folders.
- Buckets in other regions rely on the CLI's S3 region redirect.
- It needs AWS CLI v2 on the login `PATH`. It does not support remote machines.
- The tab rename retries for about 5 seconds, because Herdr may not list the pane at start.
- Do not ship an AWS logo. The header uses the neutral cloud icon.

## Done when

- `herdr-app check mods/aws-viewer` passes.
- Opening with `--props '{"profile":"dev"}'` and a working login lists `S3` and `SSM Parameter Store`. Opening `S3` loads up to 50 buckets.
- Selecting a leaf shows the details pane and runs no command.
- The tab is renamed to the profile name.
- `docker run --rm -v "$PWD/mods/aws-viewer:/w" -w /w node:22-slim node --test` passes.
