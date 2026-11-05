#!/usr/bin/env bash
# Shared by mock-aws-seed.sh and mock-aws-record.sh. Source it, do not run it.
# Starts a throwaway moto (a mock AWS) on a Docker network with no internet,
# and removes both when the script ends, also on failure or Ctrl-C.

MOTO_VERSION="5.2.5"   # pinned tag of motoserver/moto
AWS_CLI_IMAGE="amazon/aws-cli:2.39.4"
NODE_IMAGE="node:22-slim"

RUN_ID="mockaws-$$"
NET="$RUN_ID-net"
MOTO="$RUN_ID-moto"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$(mktemp -d)"   # small files the aws cli uploads (S3 objects, Lambda zip)

stop_moto() {
  docker rm -f "$MOTO" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH"
}

start_moto() {
  trap stop_moto EXIT
  trap 'exit 130' INT TERM
  # --internal: containers on this network cannot reach the internet. No port is published to the host.
  docker network create --internal "$NET" >/dev/null
  docker run -d --name "$MOTO" --network "$NET" "motoserver/moto:$MOTO_VERSION" >/dev/null
  # Wait until moto answers (checked from inside the network, with the node image).
  for _ in $(seq 1 60); do
    if docker run --rm --network "$NET" "$NODE_IMAGE" node -e "fetch('http://$MOTO:5000/moto-api/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "moto did not start" >&2
  return 1
}

# aws <args...>: run the aws cli against moto with fake credentials. Never uses ~/.aws or a real profile.
aws() {
  docker run --rm --network "$NET" -v "$SCRATCH:/data:ro" \
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
    -e AWS_DEFAULT_REGION=us-east-1 -e "AWS_ENDPOINT_URL=http://$MOTO:5000" \
    -e AWS_PAGER= "$AWS_CLI_IMAGE" "$@"
}
