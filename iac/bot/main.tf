provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ── Look up shared infra by known naming convention (name_prefix = "puli") ────

data "aws_vpc" "puli" {
  filter {
    name   = "tag:Name"
    values = ["puli-vpc"]
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.puli.id]
  }
  filter {
    name   = "tag:Name"
    values = ["puli-private-1", "puli-private-2"]
  }
}

data "aws_security_group" "envoy" {
  name   = "puli-envoy-sg"
  vpc_id = data.aws_vpc.puli.id
}

data "aws_ecs_cluster" "puli" {
  cluster_name = "puli-cluster"
}

data "aws_efs_file_system" "puli" {
  tags = { Name = "puli-efs" }
}

data "aws_iam_role" "task_execution" {
  name = "puli-task-execution-role"
}

data "aws_iam_role" "task" {
  name = "puli-task-role"
}

# ── EFS access point — isolated directory for this bot ────────────────────────

resource "aws_efs_access_point" "bot" {
  file_system_id = data.aws_efs_file_system.puli.id

  # UID/GID 1000 = the 'node' user inside the openclaw container
  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/${var.bot_name}"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${var.bot_name}-ap" }
}

# ── Secrets Manager — values come from tfvars ─────────────────────────────────

resource "aws_secretsmanager_secret" "bot" {
  name                    = "puli/${var.bot_name}"
  description             = "Runtime secrets for ${var.bot_name}"
  recovery_window_in_days = 7
  tags                    = { Name = "${var.bot_name}-secret" }
}

resource "aws_secretsmanager_secret_version" "bot" {
  secret_id = aws_secretsmanager_secret.bot.id

  secret_string = jsonencode({
    OPENCLAW_GATEWAY_TOKEN = var.openclaw_gateway_token
    ANTHROPIC_API_KEY      = var.anthropic_api_key
    TELEGRAM_BOT_TOKEN     = var.telegram_bot_token
    CLAUDE_AI_SESSION_KEY  = var.claude_ai_session_key
    CLAUDE_WEB_SESSION_KEY = var.claude_web_session_key
    CLAUDE_WEB_COOKIE      = var.claude_web_cookie
  })
}

# ── ECS ───────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "bot" {
  name              = "/ecs/${var.bot_name}"
  retention_in_days = 30
  tags              = { Name = var.bot_name }
}

locals {
  secret_keys = [
    "OPENCLAW_GATEWAY_TOKEN",
    "ANTHROPIC_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "CLAUDE_AI_SESSION_KEY",
    "CLAUDE_WEB_SESSION_KEY",
    "CLAUDE_WEB_COOKIE",
  ]
}

resource "aws_ecs_task_definition" "bot" {
  family                   = var.bot_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  execution_role_arn       = data.aws_iam_role.task_execution.arn
  task_role_arn            = data.aws_iam_role.task.arn
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)

  container_definitions = jsonencode([{
    name      = var.bot_name
    image     = var.ecr_image
    essential = true
    cpu       = var.task_cpu
    memory    = var.task_memory

    command = [
      "node", "openclaw.mjs", "gateway",
      "--allow-unconfigured",
      "--bind", "lan",
    ]

    environment = [
      { name = "HOME",              value = "/home/node" },
      { name = "TERM",              value = "xterm-256color" },
      { name = "NODE_ENV",          value = "production" },
      { name = "PNPM_HOME",         value = "/home/node/.openclaw/tools/pnpm" },
      { name = "NPM_CONFIG_PREFIX", value = "/home/node/.openclaw/tools/npm-global" },
      { name = "PATH",              value = "/home/node/.openclaw/tools/pnpm:/home/node/.openclaw/tools/npm-global/bin:/usr/local/bin:/usr/bin:/bin" },
      { name = "S3_BUCKET",         value = "puli-envoy-outputs-${data.aws_caller_identity.current.account_id}" },
      { name = "S3_PREFIX",         value = "${var.bot_name}/" },
    ]

    secrets = [for key in local.secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.bot.arn}:${key}::"
    }]

    mountPoints = [{
      sourceVolume  = "openclaw-data"
      containerPath = "/home/node/.openclaw"
      readOnly      = false
    }]

    portMappings = [{
      containerPort = 18789
      protocol      = "tcp"
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.bot.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "gateway"
      }
    }

    ulimits = [{
      name      = "nofile"
      softLimit = 65536
      hardLimit = 65536
    }]
  }])

  volume {
    name = "openclaw-data"
    efs_volume_configuration {
      file_system_id     = data.aws_efs_file_system.puli.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.bot.id
        iam             = "ENABLED"
      }
    }
  }

  tags = { Name = var.bot_name }
}

resource "aws_ecs_service" "bot" {
  name            = var.bot_name
  cluster         = data.aws_ecs_cluster.puli.id
  task_definition = aws_ecs_task_definition.bot.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = "puli-cp"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets         = data.aws_subnets.private.ids
    security_groups = [data.aws_security_group.envoy.id]
  }

  force_new_deployment   = true
  enable_execute_command = true

  tags = { Name = var.bot_name }
}
