#!/usr/bin/env bash
set -euo pipefail

pipeline="$(git rev-parse --show-toplevel)/.woodpecker/build.yaml"

grep -Fq 'candidate-${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'name: scan-candidate' "${pipeline}"
grep -Fq 'name: sign-candidate' "${pipeline}"
grep -Fq 'name: promote-release' "${pipeline}"
grep -Fq 'sha-$${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'from_secret: github_token' "${pipeline}"
grep -Fq 'from_secret: dhi_password' "${pipeline}"

printf 'LiveSync GHCR release policy passed\n'
