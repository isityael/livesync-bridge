#!/usr/bin/env bash
set -euo pipefail

pipeline="$(git rev-parse --show-toplevel)/.woodpecker/build.yaml"
renovate_config="$(git rev-parse --show-toplevel)/.github/renovate.json"

grep -Fq 'candidate-${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'name: scan-candidate' "${pipeline}"
grep -Fq 'name: sign-candidate' "${pipeline}"
grep -Fq 'name: promote-release' "${pipeline}"
grep -Fq 'sha-$${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'from_secret: github_token' "${pipeline}"
grep -Fq 'from_secret: dhi_password' "${pipeline}"

npm_release_policy="$(jq -c '[.packageRules[] | select(.matchManagers == ["npm"]) | {minimumReleaseAge, internalChecksFilter, automerge}]' "${renovate_config}")"
[ "${npm_release_policy}" = '[{"minimumReleaseAge":"2 days","internalChecksFilter":"strict","automerge":true}]' ] || {
  echo "Renovate npm updates must remain blocked until the two-day release-age check passes" >&2
  exit 1
}

printf 'LiveSync GHCR release policy passed\n'
