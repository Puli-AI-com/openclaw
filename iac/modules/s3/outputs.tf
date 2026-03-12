output "bucket_name" {
  value = aws_s3_bucket.outputs.id
}

output "bucket_arn" {
  value = aws_s3_bucket.outputs.arn
}
