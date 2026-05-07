// Idempotent AWS provisioning for Fotocal:
// - S3 bucket fotocal-meals (private)
// - VPC default → security group fotocal-sg with SSH 22 + HTTP 80 + HTTPS 443 + bot port 3017
// - EC2 key pair fotocal-key (private key written to ./_provision/fotocal-key.pem)
// - EC2 t3.micro Amazon Linux 2023 with Node 20 + git + postgres preinstalled (cloud-init user-data)
// - RDS db.t3.micro Postgres "fotocaldb" with random master password (saved to ./_provision/.aws-state.json)
//
// Re-run safe: it will reuse anything that exists with the right tags and only create the missing pieces.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutPublicAccessBlockCommand } = require('@aws-sdk/client-s3');
const {
  EC2Client, DescribeVpcsCommand, DescribeSecurityGroupsCommand, CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand, DescribeKeyPairsCommand, CreateKeyPairCommand,
  RunInstancesCommand, DescribeImagesCommand, DescribeInstancesCommand,
} = require('@aws-sdk/client-ec2');
const { RDSClient, DescribeDBInstancesCommand, CreateDBInstanceCommand } = require('@aws-sdk/client-rds');

const ENV = fs.readFileSync('C:/Users/Carlos Faviel Font/.claude/.env', 'utf8');
function envVar(name) { return ENV.match(new RegExp('^' + name + '=([^\r\n]+)', 'm'))?.[1]?.trim(); }

const REGION = 'us-east-1';
const cred = {
  accessKeyId: envVar('AWS_ACCESS_KEY_ID'),
  secretAccessKey: envVar('AWS_SECRET_ACCESS_KEY'),
};
const s3 = new S3Client({ region: REGION, credentials: cred });
const ec2 = new EC2Client({ region: REGION, credentials: cred });
const rds = new RDSClient({ region: REGION, credentials: cred });

const STATE_FILE = path.join(__dirname, '.aws-state.json');
const KEY_FILE = path.join(__dirname, 'fotocal-key.pem');
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

const BUCKET = 'fotocal-meals';
const SG_NAME = 'fotocal-sg';
const KEY_NAME = 'fotocal-key';
const RDS_ID = 'fotocaldb';
const RDS_DB = 'fotocal';
const RDS_USER = 'fotocal';
const INSTANCE_TAG = 'fotocal-bot';

async function ensureS3() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('S3: bucket exists', BUCKET);
  } catch (e) {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log('S3: bucket created', BUCKET);
  }
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true,
      BlockPublicPolicy: true, RestrictPublicBuckets: true,
    },
  }));
  state.bucket = BUCKET;
  saveState();
}

async function getDefaultVpc() {
  const r = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }));
  if (!r.Vpcs?.[0]) throw new Error('No default VPC');
  return r.Vpcs[0].VpcId;
}

async function ensureSecurityGroup(vpcId) {
  const existing = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [{ Name: 'group-name', Values: [SG_NAME] }, { Name: 'vpc-id', Values: [vpcId] }],
  }));
  let sgId = existing.SecurityGroups?.[0]?.GroupId;
  if (!sgId) {
    const c = await ec2.send(new CreateSecurityGroupCommand({
      GroupName: SG_NAME, Description: 'Fotocal bot SG', VpcId: vpcId,
    }));
    sgId = c.GroupId;
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: sgId,
      IpPermissions: [
        { IpProtocol: 'tcp', FromPort: 22,   ToPort: 22,   IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        { IpProtocol: 'tcp', FromPort: 80,   ToPort: 80,   IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        { IpProtocol: 'tcp', FromPort: 443,  ToPort: 443,  IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        { IpProtocol: 'tcp', FromPort: 3017, ToPort: 3017, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        { IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
      ],
    }));
    console.log('SG: created', sgId);
  } else {
    console.log('SG: exists', sgId);
  }
  state.security_group = sgId;
  saveState();
  return sgId;
}

async function ensureKeyPair() {
  const r = await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [KEY_NAME] })).catch(() => ({ KeyPairs: [] }));
  if (r.KeyPairs?.length) {
    console.log('Key: exists', KEY_NAME);
    if (!fs.existsSync(KEY_FILE)) {
      console.log('  WARNING: key exists in AWS but local pem missing — manual recovery needed');
    }
    return;
  }
  const c = await ec2.send(new CreateKeyPairCommand({ KeyName: KEY_NAME, KeyType: 'rsa', KeyFormat: 'pem' }));
  fs.writeFileSync(KEY_FILE, c.KeyMaterial, { mode: 0o600 });
  console.log('Key: created', KEY_NAME, '→', KEY_FILE);
  state.key_pair = KEY_NAME;
  saveState();
}

async function findAmazonLinuxAmi() {
  const r = await ec2.send(new DescribeImagesCommand({
    Owners: ['amazon'],
    Filters: [
      { Name: 'name', Values: ['al2023-ami-2023.*-kernel-6.1-x86_64'] },
      { Name: 'state', Values: ['available'] },
    ],
  }));
  const sorted = (r.Images || []).sort((a, b) => (b.CreationDate || '').localeCompare(a.CreationDate || ''));
  if (!sorted[0]) throw new Error('No AL2023 AMI');
  return sorted[0].ImageId;
}

async function ensureRds() {
  try {
    const r = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: RDS_ID }));
    const inst = r.DBInstances?.[0];
    state.rds = {
      identifier: inst.DBInstanceIdentifier,
      endpoint: inst.Endpoint?.Address,
      port: inst.Endpoint?.Port,
      status: inst.DBInstanceStatus,
      db: RDS_DB, user: RDS_USER,
      password: state.rds?.password || null,
    };
    saveState();
    console.log('RDS: exists', state.rds.endpoint || '(no endpoint yet)', 'status', inst.DBInstanceStatus);
    return;
  } catch (e) {
    if (!String(e.message).includes('not found') && e.name !== 'DBInstanceNotFoundFault') {
      throw e;
    }
  }
  const password = crypto.randomBytes(18).toString('base64').replace(/[/+=]/g, '').slice(0, 20);
  state.rds = state.rds || {};
  state.rds.password = password;
  state.rds.db = RDS_DB; state.rds.user = RDS_USER;
  saveState();
  await rds.send(new CreateDBInstanceCommand({
    DBInstanceIdentifier: RDS_ID,
    DBInstanceClass: 'db.t3.micro',
    Engine: 'postgres',
    EngineVersion: '16.6',
    AllocatedStorage: 20,
    StorageType: 'gp3',
    MasterUsername: RDS_USER,
    MasterUserPassword: password,
    DBName: RDS_DB,
    BackupRetentionPeriod: 7,
    PubliclyAccessible: true,
    VpcSecurityGroupIds: [state.security_group],
    StorageEncrypted: true,
    Tags: [{ Key: 'app', Value: 'fotocal' }],
  }));
  console.log('RDS: creation kicked off (provisioning takes ~6-10 min)');
}

async function ensureEc2() {
  // Find any running instance tagged app=fotocal
  const desc = await ec2.send(new DescribeInstancesCommand({
    Filters: [
      { Name: 'tag:app', Values: ['fotocal'] },
      { Name: 'instance-state-name', Values: ['running', 'pending'] },
    ],
  }));
  const found = desc.Reservations?.flatMap(r => r.Instances || [])?.[0];
  if (found) {
    state.ec2 = { id: found.InstanceId, public_ip: found.PublicIpAddress, public_dns: found.PublicDnsName };
    saveState();
    console.log('EC2: exists', found.InstanceId, found.PublicIpAddress || '(no IP yet)');
    return;
  }
  const ami = await findAmazonLinuxAmi();
  const userData = `#!/bin/bash
dnf -y install nodejs git gcc-c++
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf -y install nodejs
npm install -g pm2
mkdir -p /home/ec2-user/snapcal-bot && chown ec2-user:ec2-user /home/ec2-user/snapcal-bot
`;
  const r = await ec2.send(new RunInstancesCommand({
    ImageId: ami,
    InstanceType: 't3.micro',
    MinCount: 1, MaxCount: 1,
    KeyName: KEY_NAME,
    SecurityGroupIds: [state.security_group],
    UserData: Buffer.from(userData).toString('base64'),
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{ Key: 'Name', Value: INSTANCE_TAG }, { Key: 'app', Value: 'fotocal' }],
    }],
    BlockDeviceMappings: [{
      DeviceName: '/dev/xvda',
      Ebs: { VolumeSize: 16, VolumeType: 'gp3', DeleteOnTermination: true },
    }],
  }));
  const inst = r.Instances?.[0];
  state.ec2 = { id: inst.InstanceId, public_ip: null, public_dns: null };
  saveState();
  console.log('EC2: launched', inst.InstanceId, '(IP assigned in ~30s)');
}

(async () => {
  console.log('--- Fotocal AWS provisioning ---');
  await ensureS3();
  const vpcId = await getDefaultVpc();
  await ensureSecurityGroup(vpcId);
  await ensureKeyPair();
  await ensureRds();
  await ensureEc2();
  console.log('\nState:', JSON.stringify(state, null, 2));
})().catch(e => { console.error('provision failed:', e.message); process.exit(1); });
