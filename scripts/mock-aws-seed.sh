#!/usr/bin/env bash
# Starts moto, seeds small sample data, prints a short count, then removes moto.
# Usage: scripts/mock-aws-seed.sh
# mock-aws-record.sh sources this file and calls `seed` itself.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/mock-aws-common.sh"

REGIONS="us-east-1 eu-west-1"
ACCOUNT="123456789012"   # moto's fixed account id

seed() {
  # Small files for uploads. An empty zip is accepted by moto as Lambda code.
  printf 'id,total\n1,10\n' > "$SCRATCH/data.csv"
  printf 'hello\n' > "$SCRATCH/note.txt"
  printf 'PK\005\006\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000' > "$SCRATCH/empty.zip"
  printf '{"schemaVersion":2,"mediaType":"application/vnd.docker.distribution.manifest.v2+json","config":{"mediaType":"application/vnd.docker.container.image.v1+json","size":10,"digest":"sha256:%064d"},"layers":[]}' 1 > "$SCRATCH/manifest.json"
  chmod -R a+rX "$SCRATCH"

  seed_global
  for region in $REGIONS; do seed_regional "$region"; done
}

seed_global() {
  # IAM: more than 2 of each, so a page of 2 has a second page.
  for u in alice bob carol; do aws iam create-user --user-name "$u" >/dev/null; done
  for r in app-role batch-role web-role; do
    aws iam create-role --role-name "$r" --description "Sample role $r" --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  done
  for g in admins readers developers; do aws iam create-group --group-name "$g" >/dev/null; done
  aws iam create-policy --policy-name read-reports --policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}]}' >/dev/null

  # S3: buckets with prefixes and a few objects.
  for b in reports-bucket logs-bucket assets-bucket; do aws s3api create-bucket --bucket "$b" >/dev/null; done
  for key in readme.txt reports/2024-05.csv reports/2024-06.csv reports/daily/2024-06-01.csv reports/archive/old.csv; do
    aws s3api put-object --bucket reports-bucket --key "$key" --body /data/data.csv >/dev/null
  done
  # reports-bucket has every bucket setting; logs-bucket keeps moto's defaults (no ownership, encryption or access block).
  aws s3api put-bucket-ownership-controls --bucket reports-bucket --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]' >/dev/null
  aws s3api put-bucket-versioning --bucket reports-bucket --versioning-configuration Status=Enabled >/dev/null
  aws s3api put-bucket-encryption --bucket reports-bucket --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab"}}]}' >/dev/null
  aws s3api put-public-access-block --bucket reports-bucket --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
  aws s3api put-object --bucket logs-bucket --key note.txt --body /data/note.txt >/dev/null
}

seed_regional() {
  local region="$1" r="--region $region"

  # Secrets Manager: 3 secrets, one with a path-like name.
  for s in app/db app/api-key plain; do
    aws secretsmanager create-secret $r --name "$s" --description "Sample secret $s" --secret-string 'not-a-real-secret' >/dev/null
  done

  # SSM: a path hierarchy plus one parameter at the root.
  aws ssm put-parameter $r --name /app/dev/feature-flag --type String --value on >/dev/null
  aws ssm put-parameter $r --name /app/dev/db/host --type String --value db.example.test >/dev/null
  aws ssm put-parameter $r --name /app/dev/db/password --type SecureString --value not-a-real-secret >/dev/null
  aws ssm put-parameter $r --name /app/prod/feature-flag --type String --value off >/dev/null
  aws ssm put-parameter $r --name /other/setting --type String --value 1 >/dev/null
  aws ssm put-parameter $r --name plain-root-param --type String --value x >/dev/null

  # Lambda: 3 functions.
  aws iam create-role --role-name "lambda-exec-$region" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null 2>&1 || true
  for f in report-builder image-resizer cleanup; do
    aws lambda create-function $r --function-name "$f" --runtime python3.12 --handler app.handler --memory-size 256 \
      --role "arn:aws:iam::$ACCOUNT:role/lambda-exec-$region" --zip-file fileb:///data/empty.zip >/dev/null
  done

  # ECR: 3 repositories; one image in team/web.
  for repo in team/web api worker; do aws ecr create-repository $r --repository-name "$repo" >/dev/null; done
  aws ecr put-image $r --repository-name team/web --image-tag v1.0.0 --image-manifest file:///data/manifest.json >/dev/null \
    || echo "note: moto could not put an ECR image in $region" >&2

  # EC2: 3 instances, 2 with a Name tag.
  local ami
  ami="$(aws ec2 describe-images $r --query 'Images[0].ImageId' --output text 2>/dev/null || true)"
  [ -n "$ami" ] && [ "$ami" != None ] || ami="ami-12c6146b"
  aws ec2 run-instances $r --image-id "$ami" --instance-type t3.micro --count 1 \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web-1},{Key=Env,Value=dev}]' >/dev/null
  aws ec2 run-instances $r --image-id "$ami" --instance-type t3.small --count 1 \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=worker-1}]' >/dev/null
  aws ec2 run-instances $r --image-id "$ami" --instance-type t3.micro --count 1 >/dev/null

  # EFS: 3 file systems, 2 with a Name tag.
  aws efs create-file-system $r --creation-token fs-1 --tags Key=Name,Value=shared-data >/dev/null
  aws efs create-file-system $r --creation-token fs-2 --tags Key=Name,Value=backups >/dev/null
  aws efs create-file-system $r --creation-token fs-3 >/dev/null

  # EKS: 3 clusters.
  for c in prod-cluster dev-cluster test-cluster; do
    aws eks create-cluster $r --name "$c" --role-arn "arn:aws:iam::$ACCOUNT:role/eks-role" \
      --resources-vpc-config subnetIds=subnet-12345678 >/dev/null
  done

  # RDS: 3 instances.
  for d in orders-db users-db reports-db; do
    aws rds create-db-instance $r --db-instance-identifier "$d" --db-instance-class db.t3.micro --engine postgres \
      --master-username sample_admin --master-user-password not-a-real-password --allocated-storage 20 >/dev/null
  done

  # CloudWatch: 3 metric alarms and 3 log groups.
  for a in high-cpu queue-depth disk-full; do
    aws cloudwatch put-metric-alarm $r --alarm-name "$a" --namespace AWS/EC2 --metric-name CPUUtilization --statistic Average \
      --period 300 --evaluation-periods 1 --threshold 80 --comparison-operator GreaterThanThreshold >/dev/null
  done
  aws logs create-log-group $r --log-group-name /aws/lambda/report-builder >/dev/null
  aws logs create-log-group $r --log-group-name /example/app >/dev/null
  aws logs create-log-group $r --log-group-name /example/worker >/dev/null
  aws logs put-retention-policy $r --log-group-name /aws/lambda/report-builder --retention-in-days 14 >/dev/null
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  start_moto
  seed
  echo "Seeded. Buckets: $(aws s3api list-buckets --query 'length(Buckets)'), IAM users: $(aws iam list-users --query 'length(Users)')," \
    "us-east-1 lambda: $(aws lambda list-functions --region us-east-1 --query 'length(Functions)')"
fi
