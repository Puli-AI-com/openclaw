#!/usr/bin/env bash
# Build and push the puli-envoy Docker image to ECR.
# Usage: ./scripts/build-envoy.sh
#
# NOTE: The canonical build is scripts/build-cm.sh at the repo root — it passes
# the shared_skills/runner/packages/be_app build contexts the Dockerfile requires.
# This script does not and is kept only as a thin reference.
#
# Requires:
#   - AWS CLI configured with the 'puli' profile
#   - Docker with BuildKit support (buildx)

set -euo pipefail

AWS_PROFILE="puli"
AWS_REGION="eu-west-1"
AWS_ACCOUNT="470725743950"
ECR_IMAGE="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/puli-envoy:latest"
PLATFORM="linux/arm64"

# ── ECR login ─────────────────────────────────────────────────────────────────
echo "[build] Logging in to ECR..."
aws ecr get-login-password \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# ── Build & push ──────────────────────────────────────────────────────────────
echo "[build] Building $ECR_IMAGE ($PLATFORM)..."
docker buildx build \
  --platform "$PLATFORM" \
  -t "$ECR_IMAGE" \
  --push \
  .

echo "[build] Done: $ECR_IMAGE"
