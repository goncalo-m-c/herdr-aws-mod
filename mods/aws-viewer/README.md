# Herdr Browser for AWS

A read-only AWS resource viewer laid out like a file browser. It covers S3, IAM, Secrets Manager, Lambda, ECR, EC2, EFS, EKS, RDS, CloudWatch and SSM Parameter Store.

## What it does

- The root lists eleven services: **S3**, **IAM**, **Secrets Manager**, **Lambda**, **ECR**, **EC2**, **EFS**, **EKS**, **RDS**, **CloudWatch** and **SSM Parameter Store**. Nothing loads until you open a node.
- **S3**: opening it lists buckets. Opening a bucket or prefix lists one level: prefixes are folders, objects are leaves.
- **IAM** (global, shown once): opening it shows four folders: Users, Roles, Groups and Policies (local). Each folder lists that kind of resource. Only customer-managed policies are listed.
- **Secrets Manager** (regional): opening it lists secret names. A secret shows its ARN, description and dates. The secret value is never read.
- **Lambda** (regional): opening it lists function names. A function shows its name, runtime, memory and last modified date. The function code is never downloaded.
- **ECR** (regional): opening it lists repositories as folders. A repository opens to its images, which show their tags, pushed date and size. Image contents are never pulled.
- **EC2** (regional): opening it lists instances. An instance shows its ID, Name tag, state, type, availability zone and private IP. User data, other tags and console output are never read.
- **EFS** (regional): opening it lists file systems. A file system shows its ID, name, size, performance mode and state.
- **EKS** (regional): opening it lists clusters as folders. A cluster opens to one details row with its version, status, endpoint and created date.
- **RDS** (regional): opening it lists DB instances. An instance shows its identifier, engine, version, class, status and endpoint. Master usernames and passwords are never read.
- **CloudWatch** (regional): each region group has two folders, **Alarms** (metric alarms) and **Log groups**. An alarm shows its name, state, metric, namespace, threshold and last state update. A log group shows its name, stored bytes, retention days and created date. Metric data and log events are never read.
- **SSM**: opening it lists the parameter hierarchy. `/app/env/...` segments are folders, parameters are leaves.
- Each folder loads 50 items per page. A **Load more…** row appears while a next token exists.
- Selecting a leaf opens a read-only details pane with metadata:
  - S3 object: bucket, key, size, last modified, storage class, ETag.
  - IAM user, role, group or policy: name, ARN, ID, path, created date and a few type-specific fields.
  - Secret: name, ARN, description, last changed, last accessed, created.
  - EC2 instance: ID, name, state, type, zone, private IP. EFS file system: ID, name, size, performance mode, state.
  - EKS cluster: name, version, status, endpoint, created. RDS instance: identifier, engine, version, class, status, endpoint.
  - CloudWatch alarm: name, state, metric, namespace, threshold, last state update. Log group: name, stored bytes, retention, created.
  - SSM parameter: name, type, version, last modified, description, tier, data type.
- Each loaded folder has a refresh button. The header button reads `AWS_PROFILE` again and resets the tree.
- Loading, empty and error states show inline in the tree. Errors include expired login, access denied and a missing CLI.

## Profile and region

- The profile comes from `AWS_PROFILE`, read from your login shell (`$SHELL -lc`). Herdr's own environment may lack it.
- The region comes from `AWS_REGION`, else `AWS_DEFAULT_REGION`. If neither is set, the profile's config region applies.
- Props override both: `{"profile": "dev", "region": "eu-west-1"}`.
- The `regions` prop lists several regions: `{"profile": "dev", "regions": ["us-east-1", "eu-west-1"]}`. Regional services (SSM, Secrets Manager, Lambda, ECR, EC2, EFS, EKS, RDS, CloudWatch) show one group per region, and every call under a group gets that group's `--region`. Global services (S3, IAM) show once. A name that does not look like `xx-name-N` is refused. Without `regions`, one region is used as before.

## The aws commands it runs

Every call gets `--profile=<p> [--region=<r>] --output=json --no-cli-pager --no-cli-auto-prompt`.

| Node | Command |
|---|---|
| S3 | `aws s3api list-buckets --no-paginate --max-buckets=50 [--continuation-token=T]` |
| Bucket / prefix | `aws s3api list-objects-v2 --no-paginate --bucket=B [--prefix=P] --delimiter=/ --max-keys=50 [--continuation-token=T]` |
| IAM users | `aws iam list-users --max-items=50 [--starting-token=T]` |
| IAM roles | `aws iam list-roles --max-items=50 [--starting-token=T]` |
| IAM groups | `aws iam list-groups --max-items=50 [--starting-token=T]` |
| IAM policies | `aws iam list-policies --scope=Local --max-items=50 [--starting-token=T]` |
| Secrets Manager | `aws secretsmanager list-secrets --no-paginate --max-results=50 [--next-token=T]` |
| Lambda | `aws lambda list-functions --max-items=50 [--starting-token=T]` |
| ECR repositories | `aws ecr describe-repositories --max-items=50 [--starting-token=T]` |
| ECR images (inside a repository) | `aws ecr describe-images --repository-name=R --max-items=50 [--starting-token=T]` |
| EC2 | `aws ec2 describe-instances --max-items=50 [--starting-token=T]` |
| EFS | `aws efs describe-file-systems --max-items=50 [--starting-token=T]` |
| EKS clusters | `aws eks list-clusters --max-items=50 [--starting-token=T]` |
| EKS cluster details (inside a cluster) | `aws eks describe-cluster --name=C` |
| RDS | `aws rds describe-db-instances --max-items=50 [--starting-token=T]` |
| CloudWatch Alarms | `aws cloudwatch describe-alarms --max-items=50 [--starting-token=T]` |
| CloudWatch Log groups | `aws logs describe-log-groups --max-items=50 [--starting-token=T]` |
| SSM root | `aws ssm describe-parameters --no-paginate --max-results=50 [--next-token=T]` |
| SSM folder | same, plus `--parameter-filters=[{"Key":"Path","Option":"Recursive","Values":["/app"]}]` |
| Header region | `aws configure get region` (a local read of `~/.aws/config`) |

IAM, Lambda, ECR, EC2, EFS, EKS, RDS and CloudWatch (alarms and log groups) use the CLI's paging, since they have no native page-size flag, and the CLI rejects `--no-paginate` together with `--max-items`, so their calls use the CLI's `--max-items` and `--starting-token`. For the other services, `--no-paginate` with the native page size and token makes exactly one API call per page. The CLI's `--max-items` counts only `Contents`. On a prefix-only bucket level, `--max-items` would therefore walk every page.

Selecting a leaf makes no call. The details come from the listing.

## Safety

All `aws` calls go through `aws.js` → `invocation()` in `aws-args.js`. That function checks these rules before any argv exists:

1. **Read-only allowlist.** Only `s3api list-buckets`, `s3api list-objects-v2`, `ssm describe-parameters`, `iam list-users`, `iam list-roles`, `iam list-groups`, `iam list-policies`, `secretsmanager list-secrets`, `lambda list-functions`, `ecr describe-repositories`, `ecr describe-images`, `ec2 describe-instances`, `efs describe-file-systems`, `eks list-clusters`, `eks describe-cluster`, `rds describe-db-instances`, `cloudwatch describe-alarms`, `logs describe-log-groups` and `configure get` pass. The viewer refuses any argument that contains `decryption`.
2. **Value safety.** Values use the `--flag=value` form, so a name that starts with `-` is never read as a flag. The viewer refuses resource names that look like `file://` or other URLs. The CLI would read those from disk.
3. **Region format.** The region must look like `xx-name-N`.

The viewer never reads or shows parameter or secret values (`secretsmanager get-secret-value` is not allowed). It never downloads object contents and never writes to AWS. Output stays in memory. Nothing goes to files or to `console.log`.

## Open it

```sh
herdr-app do tab.new --name aws --mod aws-viewer --props '{}'
```

## Tests

The pure modules have unit tests. Run them in Docker, with no network:

```sh
docker run --rm --network none -v ~/.config/herdr-app/mods/aws-viewer:/w:ro -w /w node:22-slim node --test
```

## Limitations

- This is an early release. It has been tested against a mock AWS (moto), not yet against a real AWS account.
- SSM has no API that lists folders. Folders come from the parameters each page returns. A "Load more" may only add new folders.
- SSM root and folder pages list all descendants recursively. The viewer groups them by the next path segment.
- `$SHELL -lc` does not read `.zshrc`. Set `AWS_PROFILE` in `.zshenv` or `.zprofile`, or pass it as a prop.
- Buckets in other regions rely on the CLI's S3 region redirect.
- The tree has no keyboard navigation and no search.
