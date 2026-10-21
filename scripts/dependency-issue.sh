#!/usr/bin/env bash
# Create or update the single issue that tracks available dependency updates.
#
# Used by the scheduled `dependency-check` GitLab CI job. Keeps exactly one
# issue alive so the project does not accumulate a new one every week.
#
# Requires CI_JOB_TOKEN (or CI_TOKEN) and CI_PROJECT_ID to be set.
set -euo pipefail

TITLE="Dependency updates available"
LABEL="type/chore"
API="https://gitlab.com/api/v4/projects/${CI_PROJECT_ID}/issues"

if [[ -z "${CI_JOB_TOKEN:-${CI_TOKEN:-}}" || -z "${CI_PROJECT_ID:-}" ]]; then
  echo "CI_JOB_TOKEN and CI_PROJECT_ID must be set" >&2
  exit 1
fi

# The report is on stdin.
REPORT=$(cat)

# Find the existing tracking issue, if there is one.
EXISTING=$(curl -sS --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  "${API}?state=opened&search=$(printf '%s' "$TITLE" | sed 's/ /%20/g')&per_page=100" \
  | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let issues = [];
      try { issues = JSON.parse(raw); } catch { issues = []; }
      const match = issues.find((i) => i.title === process.argv[1]);
      process.stdout.write(match ? String(match.iid) : "");
    });
  ' "$TITLE")

if [[ -n "$EXISTING" ]]; then
  echo "Updating issue !${EXISTING}"
  curl -sS --request PUT --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
    --data-urlencode "description=${REPORT}" \
    "${API}/${EXISTING}" > /dev/null
  echo "Updated issue !${EXISTING}"
else
  echo "Creating a new issue"
  curl -sS --request POST --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
    --data-urlencode "title=${TITLE}" \
    --data-urlencode "description=${REPORT}" \
    --data-urlencode "labels=${LABEL}" \
    "${API}" > /dev/null
  echo "Created the tracking issue"
fi
