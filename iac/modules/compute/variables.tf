variable "name_prefix" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "envoy_sg_id" {
  description = "Security group applied to EC2 instances (same SG used for task ENIs)"
  type        = string
}

variable "s3_bucket_arn" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "instance_count" {
  type    = number
  default = 2
}
