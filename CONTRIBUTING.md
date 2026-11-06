# Contributing

## Commit messages and PR titles

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
messages and PR titles: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`.

Only commits that change files under `mods/` produce a release, because
`mods` is the package path in `release-please-config.json`. Changes to docs,
scripts and CI outside `mods/` never trigger a release, and they do not show
up in the changelog.

Among the commits that touch `mods/`, only `feat`, `fix`, `perf`, `revert`
and `docs` produce a release and a changelog entry. The other types are fine,
but they do not trigger a release by themselves.

## Merging

Merge PRs with "Squash and merge" and give the PR a conventional title. This
way `main` has one conventional commit per PR.

## How releases work

After merges to `main`, the release-please action opens or updates a "release
PR". Merging that PR creates the tag `v<version>` and the GitHub Release.

The first release is pinned to 0.1.0 with `release-as` in
`release-please-config.json`. Remove that line after the 0.1.0 release PR is
merged, or every later release will stay at 0.1.0.

Repository setting: "Allow GitHub Actions to create and approve pull requests"
(Settings > Actions > General) must be on, or the action cannot open the
release PR.

## Tests

```sh
docker run --rm --network none -v "$PWD/mods/aws-viewer:/w:ro" -w /w node:22-slim node --test "tests/*.test.js"
```
