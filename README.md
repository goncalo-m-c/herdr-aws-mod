# aws-viewer

A read-only AWS viewer for [Herdr](https://herdr.dev). It shows S3 buckets, IAM resources, Secrets Manager secrets, Lambda functions, ECR repositories and images, EC2 instances, EFS file systems, EKS clusters, RDS DB instances, CloudWatch alarms and log groups, and SSM Parameter Store parameters as a lazy tree with a details pane. It is a prototype.

![AWS Viewer](preview.png)

See [RECIPE.md](RECIPE.md) for the full brief. The mod lives in `mods/aws-viewer/`.

## Install

Copy the mod folder into Herdr's mods directory:

```sh
cp -R mods/aws-viewer ~/.config/herdr-app/mods/aws-viewer
```

## Open it

```sh
herdr-app do tab.new --mod aws-viewer --props '{}'
```

Launch props (all optional):

- `profile`: the AWS profile to use.
- `region`: the AWS region to use.
- `regions`: a list of AWS regions. Regional services (SSM, Secrets Manager, Lambda, ECR, EC2, EFS, EKS, RDS, CloudWatch) show one group per region. Global services (S3, IAM) show once.

Example: `--props '{"profile": "dev", "region": "eu-west-1"}'`.
Several regions: `--props '{"profile": "dev", "regions": ["us-east-1", "eu-west-1"]}'`.
An invalid region name is refused and nothing is shown. Without `regions`, the viewer uses one region as before.
Without props, the mod reads `AWS_PROFILE`, then `AWS_REGION` or `AWS_DEFAULT_REGION`, from your login shell.
The tab is renamed to `☁ <profile>`, unless you named it yourself.

## Read-only

The mod never writes to AWS. Only `s3api list-buckets`, `s3api list-objects-v2`, `ssm describe-parameters`, `iam list-users`, `iam list-roles`, `iam list-groups`, `iam list-policies`, `secretsmanager list-secrets`, `lambda list-functions`, `ecr describe-repositories`, `ecr describe-images`, `ec2 describe-instances`, `efs describe-file-systems`, `eks list-clusters`, `eks describe-cluster`, `rds describe-db-instances`, `cloudwatch describe-alarms`, `logs describe-log-groups` and `configure get` are allowed. Any argument that contains `decryption` is refused.

## What it does on your computer

- It runs `aws` with exactly these subcommands, and only these:
  - `aws s3api list-buckets`
  - `aws s3api list-objects-v2`
  - `aws ssm describe-parameters`
  - `aws iam list-users`, `aws iam list-roles`, `aws iam list-groups`, `aws iam list-policies --scope=Local`
  - `aws secretsmanager list-secrets`
  - `aws lambda list-functions`
  - `aws ecr describe-repositories`, `aws ecr describe-images`
  - `aws ec2 describe-instances`, `aws efs describe-file-systems`
  - `aws eks list-clusters`, `aws eks describe-cluster`, `aws rds describe-db-instances`
  - `aws cloudwatch describe-alarms`, `aws logs describe-log-groups`
  - `aws configure get region` (a local read of your AWS config)
- It runs one `sh -c` login-shell call to read `AWS_PROFILE`, `AWS_REGION` and `AWS_DEFAULT_REGION`.
- It writes nothing: no files, no logs, no AWS changes.
- It shows no secrets. SSM parameter values and Secrets Manager secret values are never fetched, only metadata. Lambda code and ECR image contents are never downloaded. EC2 user data, console output and password data, and RDS master usernames and passwords are never read. CloudWatch metric data and log events are never read.
- It never downloads S3 contents, only listings.
- Network access happens only through the AWS CLI.

## Requirements

- AWS CLI v2 on the `PATH` of your login shell.
- An AWS profile with list permissions.

## Limitations

- This is a prototype. The author tested it only lightly against real accounts.
- SSM has no folder API. The mod derives folders on the client from the parameter names on each page.
- It does not support remote machines.
- It has no search and no keyboard navigation.

## Tests

```sh
docker run --rm --network none -v "$PWD/mods/aws-viewer:/w:ro" -w /w node:22-slim node --test "tests/*.test.js"
```

## Testing against a mock AWS

The parser tests read JSON that was recorded from [moto](https://github.com/getmoto/moto), a mock AWS, so they use real response shapes and paging keys. You only need Docker. The scripts live in `scripts/` (not inside `mods/aws-viewer`, so they are not copied with the mod).

```sh
# Start moto, seed sample data, print a short count, remove moto (about a minute)
scripts/mock-aws-seed.sh

# Start moto, seed it, run every command the mod builds, save the JSON in mods/aws-viewer/tests/fixtures/
scripts/mock-aws-record.sh

# Run the tests on the recorded fixtures
docker run --rm --network none -v "$PWD/mods/aws-viewer:/w:ro" -w /w node:22-slim node --test "tests/*.test.js"
```

Moto runs on a Docker network with no internet and publishes no port to your machine. The AWS CLI container uses the fake keys `test`/`test`; your `~/.aws` is never mounted. Both scripts remove the container and the network when they end, also on failure. The moto version is pinned in `scripts/mock-aws-common.sh`.

A mock cannot prove:

- Real permission errors (a mock accepts every call).
- Throttling and retries.
- Small differences from real AWS. For example, moto ignores the page size for S3 `list-buckets` and SSM `describe-parameters`, so those two have no recorded second page.

Treat these tests as a check of response shapes, not of your account.

## License

[MIT](LICENSE)

## Trademarks

AWS and Amazon S3 are trademarks of Amazon.com, Inc. or its affiliates. This project is not affiliated with, endorsed by or sponsored by AWS.
