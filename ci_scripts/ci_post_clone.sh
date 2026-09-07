#!/bin/sh

# Fail immediately if a command fails
set -e

echo "=========================================="
echo "🏃 Runnie — Xcode Cloud CI Environment"
echo "=========================================="
echo "Workflow Name: ${CI_WORKFLOW:-Default}"
echo "Build Number:  ${CI_BUILD_NUMBER:-1}"
echo "Git Branch:    ${CI_BRANCH:-main}"
echo "Git Commit:    ${CI_COMMIT:-HEAD}"
echo "Primary Repo:  ${CI_PRIMARY_REPOSITORY_PATH}"
echo "=========================================="
echo "Tüm kaynak kodlar ve varlıklar hazır."
