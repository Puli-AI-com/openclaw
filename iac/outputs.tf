output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.compute.ecs_cluster_name
}

output "efs_id" {
  description = "EFS filesystem ID — referenced by bot layer via data source"
  value       = module.storage.efs_id
}

output "s3_bucket_name" {
  description = "S3 bucket for bot output files"
  value       = module.s3.bucket_name
}
