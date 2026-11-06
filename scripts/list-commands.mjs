// Prints the aws commands the mod builds, one per line, for the record script.
// The argv comes from the real builders in mods/aws-viewer/aws-args.js, never retyped.
//   node list-commands.mjs                       every command, every region
//   node list-commands.mjs --only=NAME --region=R [--token=T] [--page-size=N]
//   node list-commands.mjs --token-of=FILE       print the next-page token in a saved response
// Line format: NAME<TAB>REGION or "-"<TAB>shell-quoted argv
import { readFileSync } from "node:fs";
import * as args from "../mods/aws-viewer/aws-args.js";

const REGIONS = ["us-east-1", "eu-west-1"];
const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));

if (opt["token-of"]) {
  const json = JSON.parse(readFileSync(opt["token-of"], "utf8"));
  console.log(json.NextToken ?? json.NextContinuationToken ?? json.ContinuationToken ?? "");
  process.exit(0);
}

// name -> [regional?, builder]. The sample names match what mock-aws-seed.sh creates.
const t = opt.token || null;
const COMMANDS = {
  "s3-list-buckets": [false, () => args.listBuckets(t)],
  "s3-list-objects-root": [false, () => args.listObjects("reports-bucket", "", t)],
  "s3-list-objects-reports": [false, () => args.listObjects("reports-bucket", "reports/", t)],
  "s3-get-bucket-ownership-controls-reports": [false, () => args.getBucketOwnershipControls("reports-bucket")],
  "s3-get-bucket-versioning-reports": [false, () => args.getBucketVersioning("reports-bucket")],
  "s3-get-bucket-encryption-reports": [false, () => args.getBucketEncryption("reports-bucket")],
  "s3-get-public-access-block-reports": [false, () => args.getPublicAccessBlock("reports-bucket")],
  "s3-get-bucket-ownership-controls-logs": [false, () => args.getBucketOwnershipControls("logs-bucket")],
  "s3-get-bucket-versioning-logs": [false, () => args.getBucketVersioning("logs-bucket")],
  "s3-get-bucket-encryption-logs": [false, () => args.getBucketEncryption("logs-bucket")],
  "s3-get-public-access-block-logs": [false, () => args.getPublicAccessBlock("logs-bucket")],
  "iam-list-users": [false, () => args.listUsers(t)],
  "iam-list-roles": [false, () => args.listRoles(t)],
  "iam-list-groups": [false, () => args.listGroups(t)],
  "iam-list-policies": [false, () => args.listLocalPolicies(t)],
  "secretsmanager-list-secrets": [true, () => args.listSecrets(t)],
  "ssm-describe-parameters": [true, () => args.describeParameters("", t)],
  "ssm-describe-parameters-app-dev": [true, () => args.describeParameters("/app/dev", t)],
  "ssm-describe-parameters-app-dev-db": [true, () => args.describeParameters("/app/dev/db", t)],
  "lambda-list-functions": [true, () => args.listFunctions(t)],
  "ecr-describe-repositories": [true, () => args.describeRepositories(t)],
  "ecr-describe-images": [true, () => args.describeImages("team/web", t)],
  "ec2-describe-instances": [true, () => args.describeInstances(t)],
  "efs-describe-file-systems": [true, () => args.describeFileSystems(t)],
  "eks-list-clusters": [true, () => args.listClusters(t)],
  "eks-describe-cluster": [true, () => args.describeCluster("prod-cluster")],
  "rds-describe-db-instances": [true, () => args.describeDbInstances(t)],
  "cloudwatch-describe-alarms": [true, () => args.describeAlarms(t)],
  "logs-describe-log-groups": [true, () => args.describeLogGroups(t)],
};

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
for (const [name, [regional, build]] of Object.entries(COMMANDS)) {
  if (opt.only && opt.only !== name) continue;
  for (const region of regional ? (opt.region ? [opt.region] : REGIONS) : [""]) {
    let command = build();
    // Smaller pages for the second-page recordings: only the --max-* value changes.
    if (opt["page-size"]) command = command.map((a) => a.replace(/^(--max-[a-z]+=)\d+$/, `$1${opt["page-size"]}`));
    // The same flags the mod adds: --region, --output=json, --no-cli-pager, --no-cli-auto-prompt (no profile).
    const argv = args.invocation(command, { profile: "", region });
    console.log(`${name}\t${region || "-"}\t${argv.map(quote).join(" ")}`);
  }
}
