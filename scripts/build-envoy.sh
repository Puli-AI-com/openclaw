#!/usr/bin/env bash
# Build and push the puli-envoy Docker image to ECR.
# Usage: ./scripts/build-envoy.sh
#
# Requires:
#   - AWS CLI configured with the 'puli' profile
#   - GITHUB_TOKEN env var set, or stored in AWS Secrets Manager at puli/shared_envoys_secrets
#   - Docker with BuildKit support (buildx)

set -euo pipefail

AWS_PROFILE="puli"
AWS_REGION="eu-west-1"
AWS_ACCOUNT="470725743950"
ECR_IMAGE="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/puli-envoy:latest"
PLATFORM="linux/arm64"

# ── Resolve GitHub token ──────────────────────────────────────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[build] GITHUB_TOKEN not set — fetching from Secrets Manager..."
  GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id "puli/shared_envoys_secrets" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --query 'SecretString' \
    --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['GITHUB_TOKEN'])")
fi

# ── ECR login ─────────────────────────────────────────────────────────────────
echo "[build] Logging in to ECR..."
aws ecr get-login-password \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# ── Build & push ──────────────────────────────────────────────────────────────
echo "[build] Building $ECR_IMAGE ($PLATFORM)..."
GITHUB_TOKEN="$GITHUB_TOKEN" docker buildx build \
  --platform "$PLATFORM" \
  --secret id=github_token,env=GITHUB_TOKEN \
  -t "$ECR_IMAGE" \
  --push \
  .

echo "[build] Done: $ECR_IMAGE"
