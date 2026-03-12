output "service_name" {
  value = aws_ecs_service.bot.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.bot.arn
}

output "secret_arn" {
  description = "Secrets Manager ARN for this bot"
  value       = aws_secretsmanager_secret.bot.arn
}
