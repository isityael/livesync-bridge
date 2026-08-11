#!/bin/sh
set -eu
sha="${1:?commit SHA is required}"; shift
: "${FORGEJO_API_URL:?}" "${FORGEJO_REPOSITORY:?}" "${FORGEJO_TOKEN:?}"
attempt=1; max="${WOODPECKER_GATE_MAX_ATTEMPTS:-240}"; delay="${WOODPECKER_GATE_SLEEP_SECONDS:-15}"
while [ "$attempt" -le "$max" ]; do
  statuses="$(curl --fail --silent --show-error --header "Authorization: token ${FORGEJO_TOKEN}" "${FORGEJO_API_URL}/repos/${FORGEJO_REPOSITORY}/statuses/${sha}?limit=100")"
  waiting=0
  for context in "$@"; do
    state="$(printf '%s' "$statuses" | jq -r --arg c "$context" '[.[]|select(.context==$c)][0].status // "missing"')"
    case "$state" in success) echo "$context: success";; failure|error|killed|cancelled|canceled) echo "$context: $state" >&2; exit 1;; *) echo "$context: $state; waiting"; waiting=1;; esac
  done
  [ "$waiting" -eq 1 ] || exit 0
  [ "$attempt" -lt "$max" ] || break
  sleep "$delay"; attempt=$((attempt+1))
done
echo "Woodpecker status gate timed out for $sha" >&2; exit 1
