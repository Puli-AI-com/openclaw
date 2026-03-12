output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "envoy_sg_id" {
  value = aws_security_group.envoy.id
}

output "efs_sg_id" {
  value = aws_security_group.efs.id
}

output "cloudmap_namespace_id" {
  value = aws_service_discovery_private_dns_namespace.puli.id
}

output "cloudmap_namespace_name" {
  value = aws_service_discovery_private_dns_namespace.puli.name
}
