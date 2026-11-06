#!/usr/bin/env bash
# Starts moto, seeds it, runs every command the mod builds and saves the JSON into
# mods/aws-viewer/tests/fixtures/. Removes moto and the network at the end.
# Usage: scripts/mock-aws-record.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/mock-aws-seed.sh"

OUT="$REPO_ROOT/mods/aws-viewer/tests/fixtures"
PAGE_SIZE_FOR_PAGING=2
# Commands also recorded as page1/page2 with a page size of 2 (regional ones in us-east-1 only).
PAGED="s3-list-buckets s3-list-objects-reports iam-list-users ssm-describe-parameters secretsmanager-list-secrets lambda-list-functions ecr-describe-repositories ec2-describe-instances efs-describe-file-systems eks-list-clusters rds-describe-db-instances cloudwatch-describe-alarms logs-describe-log-groups"

# commands <helper args...>: the helper runs in a node container; the repo is mounted read-only.
commands() {
  docker run --rm --network none -v "$REPO_ROOT:/repo:ro" -w /repo/scripts "$NODE_IMAGE" node list-commands.mjs "$@"
}

# run_argv "<shell-quoted argv>" > file
run_argv() {
  eval "set -- $1"
  aws "$@"
}

file_name() { echo "$1${2:+.$2}${3:+.$3}.json"; }   # name, region (or empty), suffix (or empty)

record_one() {   # name region argv
  local name="$1" region="$2" argv="$3"
  case "$name" in
    s3-get-*) record_maybe_failing "$name" "$region" "$argv"; return ;;
  esac
  run_argv "$argv" > "$OUT/$(file_name "$name" "$region" "")" < /dev/null
}

# Bucket settings can be unset, and the CLI then fails. Keep the error text as NAME.error.txt instead of the JSON.
record_maybe_failing() {   # name region argv
  local name="$1" region="$2" argv="$3" json err
  json="$OUT/$(file_name "$name" "$region" "")"; err="${json%.json}.error.txt"
  if run_argv "$argv" > "$json" 2> "$err" < /dev/null; then rm -f "$err"; else rm -f "$json"; fi
}

record_pages() {   # name region
  local name="$1" region="$2" line argv token first second
  first="$OUT/$(file_name "$name" "$region" page1)"; second="$OUT/$(file_name "$name" "$region" page2)"
  line="$(commands --only="$name" --region="$region" --page-size=$PAGE_SIZE_FOR_PAGING | cut -f3)"
  run_argv "$line" > "$first" < /dev/null
  token="$(docker run --rm --network none -v "$REPO_ROOT:/repo:ro" -v "$OUT:/out:ro" -w /repo/scripts "$NODE_IMAGE" node list-commands.mjs --token-of="/out/$(basename "$first")")"
  if [ -z "$token" ]; then echo "note: moto gave no second page for $name with page size $PAGE_SIZE_FOR_PAGING (it ignores the size); no page files kept" >&2; rm -f "$first"; return; fi
  line="$(commands --only="$name" --region="$region" --page-size=$PAGE_SIZE_FOR_PAGING --token="$token" | cut -f3)"
  run_argv "$line" > "$second" < /dev/null
}

mkdir -p "$OUT"
start_moto
seed
while IFS=$'\t' read -r name region argv; do
  [ "$region" = "-" ] && region=""
  record_one "$name" "$region" "$argv"
  case " $PAGED " in
    *" $name "*) if [ -z "$region" ] || [ "$region" = us-east-1 ]; then record_pages "$name" "$region"; fi ;;
  esac
done < <(commands)
# moto invents random public IPs (54.214.x.x, an AWS range). Replace them with a documentation address (RFC 5737).
for f in "$OUT"/*.json; do
  sed -E -i.bak -e 's/54\.214\.[0-9]+\.[0-9]+/203.0.113.7/g' -e 's/54-214-[0-9]+-[0-9]+/203-0-113-7/g' "$f" && rm -f "$f.bak"
done
echo "Recorded $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
