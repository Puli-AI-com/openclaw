variable "aws_region" {
  description = "AWS region (must match the infra layer)"
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile to use for authentication"
  type        = string
}

variable "bot_name" {
  description = "Unique name for this bot instance (e.g. puli-envoy-1)"
  type        = string
}

variable "ecr_image" {
  description = "Full ECR image URI"
  type        = string
}

variable "task_cpu" {
  description = "ECS task CPU units"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "ECS task memory in MiB"
  type        = number
  default     = 1024
}

# ── Secrets ───────────────────────────────────────────────────────────────────
# These are stored in Secrets Manager and injected as env vars at task launch.
# Mark the tfvars file containing these as gitignored.

variable "openclaw_gateway_token" {
  description = "Unique gateway auth token for this bot"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "telegram_bot_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "claude_ai_session_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "claude_web_session_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "claude_web_cookie" {
  type      = string
  sensitive = true
  default   = ""
}
