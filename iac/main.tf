provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "puli"
}

module "networking" {
  source      = "./modules/networking"
  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
}

module "storage" {
  source             = "./modules/storage"
  name_prefix        = local.name_prefix
  private_subnet_ids = module.networking.private_subnet_ids
  efs_sg_id          = module.networking.efs_sg_id
}

module "s3" {
  source      = "./modules/s3"
  name_prefix = local.name_prefix
  account_id  = data.aws_caller_identity.current.account_id
}

module "compute" {
  source             = "./modules/compute"
  name_prefix        = local.name_prefix
  private_subnet_ids = module.networking.private_subnet_ids
  envoy_sg_id        = module.networking.envoy_sg_id
  s3_bucket_arn      = module.s3.bucket_arn
  instance_type      = var.instance_type
  instance_count     = var.instance_count
}
