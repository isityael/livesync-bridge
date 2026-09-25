#!/bin/sh
set -eu

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
pipeline="${1:-${repo_root}/.woodpecker/build.yaml}"
renovate_config="${repo_root}/.github/renovate.json"

# Match literal Woodpecker runtime expressions, not this process environment.
# shellcheck disable=SC2016
grep -Fq 'candidate-${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'name: scan-candidate' "${pipeline}"
grep -Fq 'name: sign-candidate' "${pipeline}"
grep -Fq 'name: promote-release' "${pipeline}"
# shellcheck disable=SC2016
grep -Fq 'sha-$${CI_COMMIT_SHA}' "${pipeline}"
grep -Fq 'from_secret: forgejo_package_token' "${pipeline}"
grep -Fq 'from_secret: dhi_password' "${pipeline}"

grep -Fq 'from_secret: forgejo_package_username' "${pipeline}"
grep -Fq 'repo: git.m0sh1.cc/m0sh1-internal/livesync-bridge' "${pipeline}"
grep -Fq 'sbom: true' "${pipeline}"
if grep -Eq 'ghcr\.io|from_secret: github_(username|token)' "${pipeline}"; then
  echo "Private releases must not publish or authenticate to GHCR" >&2
  exit 1
fi
if [ -f "${repo_root}/.github/workflows/publish-ghcr.yaml" ]; then
  echo "The alternate public image publisher must remain removed" >&2
  exit 1
fi
# Promotion must remain behind the blocking scan and signing steps.
awk '
  /^  - name: build-candidate$/ { if (stage != 0) exit 1; stage=1 }
  /^  - name: scan-candidate$/ { if (stage != 1) exit 1; stage=2 }
  /^  - name: sign-candidate$/ { if (stage != 2) exit 1; stage=3 }
  /^  - name: promote-release$/ { if (stage != 3) exit 1; stage=4 }
  stage == 2 && /failure: ignore/ { failed=1 }
  END { if (stage != 4 || failed) exit 1 }
' "${pipeline}"
grep -Fq 'trivy image --exit-code 1 --severity HIGH,CRITICAL' "${pipeline}"

node --input-type=module - "${renovate_config}" <<'JS'
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rules = config.packageRules.filter(rule => JSON.stringify(rule.matchManagers) === '["npm"]');
if (rules.length !== 1 || rules[0].minimumReleaseAge !== "2 days" ||
    rules[0].internalChecksFilter !== "strict" || rules[0].automerge !== true) {
  throw new Error("Renovate npm updates must remain blocked until the two-day release-age check passes");
}
JS

printf 'LiveSync private Forgejo release policy passed\n'
