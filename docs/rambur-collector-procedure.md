# Rambur Collector: Lambda/Worker Architecture, S3, and EventBridge Wiring Procedure

> **Part of**: [RBR-523](/RBR/issues/RBR-523) — SentinelOne → Drata Integration Plan
> **Owned by**: SecOps (agent: `opencode_local`)
> **Prerequisites**: [RBR-524](/RBR/issues/RBR-524) (S1 API surface), [RBR-525](/RBR/issues/RBR-525) (Drata side)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EventBridge (cron(0 * * * ? *))              │
│                    triggers every hour                               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AWS Lambda (Python 3.12)                       │
│                                                                      │
│  1. Pull S1 API token from Secrets Manager                          │
│  2. Fetch per-endpoint data (hourly/daily/weekly cadence)           │
│  3. Write raw JSON to S3 (Object Lock compliance, 7-year retention) │
│  4. Validate payload against JSON Schema                            │
│  5. Publish to SNS topic: RamburDrataIngest                         │
│     - Drata receiver (fan-out target)                               │
│     - Snowflake stage (optional)                                    │
│     - Slack webhook (optional)                                      │
│  6. On failure: CloudWatch alarm → PagerDuty → SecOps               │
└──────────────────────────────────────────────────────────────────────┘
```

### Runtime Choice: AWS Lambda (Python 3.12) — CONFIRMED

| Factor | Lambda | ECS Fargate | Verdict |
|--------|--------|-------------|---------|
| Cost (monthly) | ~$3–8 | ~$25–40 | Lambda wins |
| Cold start | ~200ms (provisioned concurrency: ~5ms) | N/A | Acceptable with provisioned concurrency |
| 15-min timeout | 900s | N/A | Sufficient per endpoint; see §4.1 |
| Observability | CloudWatch + X-Ray native | +Container Insights | Lambda simpler |
| Deployment | SAM/CDK one-step | ECR + task def | Lambda wins |
| Secrets | IAM + Secrets Manager | IAM + SM or Parameter Store | Same |

**Lambda is confirmed** with provisioned concurrency (1 reserved) to keep cold starts under 50ms. If any single endpoint consistently exceeds 15 minutes, split it into a Step Functions state machine with parallel branches.

---

## 2. AWS Resource Provisioning

### 2.1 S3 Bucket — Object Lock Compliance Mode (7-Year Retention)

**Bucket name pattern**: `rambur-collector-{env}-{region}-{account-id}`

**Configuration**:

| Setting | Value |
|---------|-------|
| Object Lock | Enabled (Compliance mode) |
| Retention period | 7 years ("2557 days") |
| Versioning | Enabled |
| Encryption | AES-256 (SSE-S3) |
| Public access | Block all |

**Object layout**:

```
s3://rambur-collector-prod-us-east-1-123456789012/
├── s1/
│   ├── agents/
│   │   ├── 2026/
│   │   │   ├── 01/
│   │   │   │   ├── 1704067200.json
│   │   │   │   └── ...
│   │   │   └── ...
│   ├── threats/
│   ├── application-risks/
│   ├── dv-events/
│   └── ranger-devices/
├── drata-push/
│   ├── succeeded/
│   └── failed/
└── collector-logs/
```

**Lifecycle rule**: (Compliance lock prevents deletion for 7 years, but transition `s1/` to S3 Glacier Instant Retrieval after 90 days and `drata-push/` to S3 Glacier Deep Archive after 365 days. Document this in the runbook.)

### 2.2 IAM Role for Lambda

**Role name**: `RamburCollectorLambdaRole`

**Trust policy**: Lambda service principal

**Attached managed policies**:
- `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole` (CloudWatch Logs)

**Inline policy (`RamburCollectorPolicy`)**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::rambur-collector-*",
        "arn:aws:s3:::rambur-collector-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:*:*:secret:sentinel-one-api-token-*"
    },
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:*:*:RamburDrataIngest*"
    },
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:*:*:key/*"
    }
  ]
}
```

### 2.3 EventBridge Schedule

**Schedule name**: `RamburCollectorHourly`

| Setting | Value |
|---------|-------|
| Rule type | Schedule |
| Cron expression | `cron(0 * * * ? *)` |
| Target | Lambda function `rambur-collector` |
| Input | `{"endpoints": ["agents","threats","application-risks","dv-events","ranger-devices"]}` |
| Retry policy | 2 retries, 60s backoff |
| State | ENABLED |

### 2.4 SNS Topic

**Topic name**: `RamburDrataIngest`

**Subscriptions**:

| Protocol | Endpoint | Status |
|----------|----------|--------|
| HTTPS | Drata receiver webhook (see §5) | Required |
| HTTPS | Snowflake stage endpoint | Optional |
| HTTPS | Slack webhook (`#secops-alerts`) | Optional |

**Delivery policy**: 5 retries, exponential backoff (1s–60s), dead-letter queue to `RamburCollectorDLQ`.

---

## 3. SentinelOne → Drata Endpoint Mapping

Per [RBR-523 §2](/RBR/issues/RBR-523), the following cadences apply:

| S1 Endpoint | Drata Custom Connection | Cadence | ISO Control(s) |
|-------------|------------------------|---------|----------------|
| `GET /agents` | `sentinelone_agent_inventory` | Hourly | A.8.1 (Endpoint Inventory) |
| `GET /threats` | `sentinelone_threat_event` | Hourly | A.8.7 (Threat Management) |
| `GET /application-risks` | `sentinelone_vulnerability_finding` | Daily | A.6.8 / A.8.8 (Vulnerability Management) |
| `GET /dv/events` | `sentinelone_dv_event` | Hourly | A.8.23 (Monitoring) |
| `GET /ranger` | `sentinelone_ranger_device` | Weekly | A.8.1 (Device Discovery) |

The Lambda receives the endpoint list from EventBridge, iterates each, and writes to the matching S3 prefix.

---

## 4. Collector Lambda — Functional Design

### 4.1 Per-Endpoint Invocation

Each endpoint is a separate invocation within the same Lambda (sequential within endpoint, parallel across endpoints using `asyncio` / `concurrent.futures`). If any endpoint exceeds 800s (the 900s Lambda limit with margin), split it into a Step Function.

### 4.2 Secrets Retrieval

```python
import boto3
import json

def get_secret(secret_name: str) -> str:
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_name)
    return json.loads(resp["SecretString"])["api_token"]
```

**IAM-authenticated, no hard-coded keys.** The secret name is injected via Lambda environment variable `S1_SECRET_NAME`. Rotation hook: Secrets Manager rotates the token; the Lambda always reads the latest version.

### 4.3 S3 Write

```python
import boto3

def write_to_s3(bucket: str, key: str, data: dict):
    s3 = boto3.client("s3")
    body = json.dumps(data, indent=2, default=str)
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
```

Key pattern: `s1/{endpoint}/{yyyy}/{mm}/{dd}/{epoch}.json`

### 4.4 Payload Validation (JSON Schema)

Before publishing to SNS, validate against a stored JSON Schema per endpoint:

```python
import json
from jsonschema import validate, ValidationError

SCHEMAS = {
    "agents": { ... },  # per RBR-524
    "threats": { ... },
    ...
}

def validate_payload(endpoint: str, payload: dict):
    schema = SCHEMAS.get(endpoint)
    if not schema:
        return True  # no schema = no validation
    try:
        validate(instance=payload, schema=schema)
        return True
    except ValidationError as e:
        logger.error(f"Validation failed for {endpoint}: {e}")
        # Write to S3 anyway (failure to push MUST NOT drop the raw file)
        return False
```

**Critical**: Validation failure does NOT block the S3 write. The raw file is always persisted. The Drata receiver will see a `schema_violation` flag in the SNS message and skip that payload.

### 4.5 SNS Publish

```python
def publish_to_sns(topic_arn: str, endpoint: str, s3_key: str, valid: bool, run_id: str):
    sns = boto3.client("sns")
    message = {
        "endpoint": endpoint,
        "s3_key": s3_key,
        "run_id": run_id,
        "timestamp": datetime.utcnow().isoformat(),
        "schema_valid": valid,
    }
    sns.publish(
        TopicArn=topic_arn,
        Message=json.dumps(message),
        MessageAttributes={
            "endpoint": {"DataType": "String", "StringValue": endpoint},
            "schema_valid": {"DataType": "String", "StringValue": str(valid)},
        },
    )
```

### 4.6 Main Handler

```python
import os
import json
from datetime import datetime, timezone

S3_BUCKET = os.environ["S3_BUCKET"]
SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
S1_SECRET_NAME = os.environ["S1_SECRET_NAME"]

def lambda_handler(event, context):
    run_id = context.aws_request_id
    endpoints = event.get("endpoints", [])
    s1_token = get_secret(S1_SECRET_NAME)

    results = {}
    for ep in endpoints:
        try:
            start = datetime.now(timezone.utc)
            data = fetch_s1_endpoint(ep, s1_token)
            s3_key = f"s1/{ep}/{start.strftime('%Y/%m/%d')}/{int(start.timestamp())}.json"
            write_to_s3(S3_BUCKET, s3_key, data)
            valid = validate_payload(ep, data)
            publish_to_sns(SNS_TOPIC_ARN, ep, s3_key, valid, run_id)
            results[ep] = {"status": "ok", "records": len(data), "s3_key": s3_key}
        except Exception as e:
            logger.exception(f"Endpoint {ep} failed: {e}")
            results[ep] = {"status": "error", "error": str(e)}
    return results
```

---

## 5. Drata Receiver Integration

The Drata receiver is an HTTPS endpoint subscribed to `RamburDrataIngest`. It:

1. Receives the SNS notification containing `endpoint`, `s3_key`, `run_id`, `timestamp`, `schema_valid`.
2. Fetches the raw JSON from S3.
3. Transforms each record into a Drata Custom Data Record (per RBR-525's schema mapping).
4. POSTs to `https://public-api.drata.com/public/v2/custom-data-records`.
5. If the Drata push fails, it writes the raw S3 key to `drata-push/failed/{endpoint}/{timestamp}.json` and re-publishes to the dead-letter queue.

**Failure MUST NOT drop the raw S3 file.** The S3 object is the system of record; Drata is best-effort delivery on top.

---

## 6. Retry, Backoff, and Circuit Breaker

### 6.1 HTTP 429 Handling

```python
def fetch_with_retry(url: str, token: str, max_retries: int = 3):
    headers = {"Authorization": f"APIToken {token}"}
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 10))
            logger.warning(f"429 on {url}, waiting {wait}s (attempt {attempt+1})")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise Exception(f"Exhausted retries for {url}")
```

### 6.2 Per-Endpoint Circuit Breaker

Track failures per endpoint in a simple in-memory dict (since Lambda is invoked every hour, a single run's failures don't carry over — use S3 or DynamoDB for cross-run state if needed):

```python
breaker_state = {}  # endpoint -> consecutive_failures

MAX_FAILURES = 3

def should_skip(endpoint: str) -> bool:
    return breaker_state.get(endpoint, 0) >= MAX_FAILURES
```

If an endpoint trips the breaker, an alert fires and it is skipped for subsequent runs until manually reset.

---

## 7. Observability

### 7.1 CloudWatch Metrics

| Metric Name | Namespace | Description |
|-------------|-----------|-------------|
| `CollectorRunDuration` | `Rambur/Collector` | Milliseconds per lambda invocation |
| `RecordsWritten` | `Rambur/Collector` | Total records written to S3 per endpoint |
| `PushFailures` | `Rambur/Collector` | Failed SNS publishes |
| `SchemaViolations` | `Rambur/Collector` | Payloads failing JSON Schema validation |
| `CircuitBreakerTripped` | `Rambur/Collector` | Per-endpoint circuit breaker triggered |

### 7.2 CloudWatch Alarms

| Alarm | Metric | Threshold | Action |
|-------|--------|-----------|--------|
| `RamburCollectorFailure` | Errors > 0 in 5m | 1 | PagerDuty → `#secops-urgent` |
| `RamburCollectorStall` | Runs missing for > 65min | 1 miss | PagerDuty → `#secops-urgent` |
| `RamburPushFailure` | `PushFailures` > 5 in 1h | 5 | PagerDuty → `#secops-alerts` |
| `RamburSchemaViolation` | `SchemaViolations` > 10 in 1h | 10 | Slack → `#secops-alerts` |

### 7.3 Logging

Structured JSON logging (via `structlog` or plain `logging` with JSON formatter):

```json
{
  "timestamp": "2026-07-17T03:00:00Z",
  "level": "INFO",
  "run_id": "abc-123",
  "endpoint": "agents",
  "records": 142,
  "s3_key": "s1/agents/2026/07/17/1704067200.json",
  "schema_valid": true,
  "duration_ms": 3200
}
```

---

## 8. Deployment — CloudFormation Template

A CloudFormation sample is provided below. For Terraform, translate using the `aws_s3_bucket`, `aws_iam_role`, `aws_lambda_function`, `aws_cloudwatch_event_rule`, `aws_sns_topic`, and `aws_cloudwatch_metric_alarm` resources.

### 8.1 CloudFormation (sam template.yaml)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Rambur Collector — SentinelOne → S3 → SNS → Drata

Parameters:
  S1SecretName:
    Type: String
    Default: sentinel-one-api-token-prod

Resources:
  CollectorBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub "rambur-collector-${AWS::Region}-${AWS::AccountId}"
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      ObjectLockEnabled: true
      ObjectLockConfiguration:
        ObjectLockRule:
          DefaultRetention:
            Mode: COMPLIANCE
            Days: 2557

  CollectorBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref CollectorBucket
      PolicyDocument:
        Statement:
          - Effect: Deny
            Principal: "*"
            Action: "s3:*"
            Resource:
              - !Sub "arn:aws:s3:::${CollectorBucket}/*"
              - !Sub "arn:aws:s3:::${CollectorBucket}"
            Condition:
              Bool:
                "aws:SecureTransport": "false"

  CollectorFunctionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: RamburCollectorLambdaRole
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: RamburCollectorPolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - s3:PutObject
                  - s3:GetObject
                  - s3:ListBucket
                Resource:
                  - !GetAtt CollectorBucket.Arn
                  - !Sub "${CollectorBucket.Arn}/*"
              - Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource: !Sub "arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${S1SecretName}-*"
              - Effect: Allow
                Action: sns:Publish
                Resource: !Ref DrataIngestTopic

  DrataIngestTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: RamburDrataIngest
      Subscription:
        - Protocol: https
          Endpoint: "https://drata-receiver.example.com/webhook"  # REPLACE
      DeliveryPolicy:
        healthyRetryPolicy:
          numRetries: 5
          minDelayTarget: 1
          maxDelayTarget: 60
          numMaxDelayRetries: 3
          backoffFunction: exponential

  DrataIngestTopicDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: RamburCollectorDLQ
      MessageRetentionPeriod: 1209600  # 14 days

  DrataIngestTopicPolicy:
    Type: AWS::SNS::TopicPolicy
    Properties:
      Topics:
        - !Ref DrataIngestTopic
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Service: sqs.amazonaws.com
            Action: sns:Publish
            Resource: !Ref DrataIngestTopic
            Condition:
              ArnEquals:
                "aws:SourceArn": !GetAtt DrataIngestTopicDLQ.Arn

  CollectorFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: rambur-collector
      Runtime: python3.12
      Handler: handler.lambda_handler
      CodeUri: ./src/
      MemorySize: 256
      Timeout: 900
      ReservedConcurrentExecutions: 1
      Environment:
        Variables:
          S3_BUCKET: !Ref CollectorBucket
          SNS_TOPIC_ARN: !Ref DrataIngestTopic
          S1_SECRET_NAME: !Ref S1SecretName
      Role: !GetAtt CollectorFunctionRole.Arn

  CollectorSchedule:
    Type: AWS::Events::Rule
    Properties:
      Name: RamburCollectorHourly
      ScheduleExpression: "cron(0 * * * ? *)"
      State: ENABLED
      Targets:
        - Arn: !GetAtt CollectorFunction.Arn
          Id: CollectorTarget
          Input: '{"endpoints": ["agents","threats","application-risks","dv-events","ranger-devices"]}'
          RetryPolicy:
            MaximumRetryAttempts: 2
            MaximumEventAgeInSeconds: 3600

  CollectorSchedulePermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref CollectorFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt CollectorSchedule.Arn

  CollectorFailureAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: RamburCollectorFailure
      MetricName: Errors
      Namespace: AWS/Lambda
      Dimensions:
        - Name: FunctionName
          Value: !Ref CollectorFunction
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Sub "arn:aws:sns:${AWS::Region}:${AWS::AccountId}:rambur-drata-ingest-alarms"
```

---

## 9. Manual First-Pass Verification

### 9.1 Prerequisites

- AWS CLI configured with appropriate credentials
- SentinelOne API token stored in Secrets Manager
- Drata API key stored in Secrets Manager
- S3 bucket deployed
- Lambda deployed and EventBridge rule active

### 9.2 Run the Lambda Manually

```bash
aws lambda invoke \
  --function-name rambur-collector \
  --payload '{"endpoints": ["agents"]}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

### 9.3 Verify S3

```bash
aws s3 ls s3://rambur-collector-prod-us-east-1-123456789012/s1/agents/$(date +%Y/%m/%d)/
```

You should see a `.json` file. Download and inspect:

```bash
aws s3 cp s3://rambur-collector-prod-us-east-1-123456789012/s1/agents/$(date +%Y/%m/%d)/<filename>.json -
```

Expected: valid JSON array of agent objects from your S1 console.

### 9.4 Verify Drata Custom Connection

1. Go to Drata → **Custom Connections** → `sentinelone_agent_inventory`
2. Click **Manual Run / Test**
3. Expected: new Custom Data Records appear with agent IDs matching your S1 console
4. Go to **Controls** → find the mapped ISO 27001:2022 control (e.g., A.8.1)
5. Run **Monitoring Test** → expected status: **Pass** with the underlying S3 link visible

---

## 10. Failure Simulation

### 10.1 Revoke the S1 API Token

1. In SentinelOne console, invalidate the collector's API token
2. Wait up to 10 minutes (next cron cycle)

**Expected results**:
- **CloudWatch** alarm `RamburCollectorFailure` fires within 10 minutes
- **PagerDuty** notification sent to `#secops-urgent`
- **Drata**: the affected control flips to `failing_evidence` (because no new evidence arrived in the expected window)
- **Paperclip**: a new issue is auto-created for **SecOps** with the S1 API token name, error message, and a link to the CloudWatch alarm

### 10.2 Make S3 Write Fail

1. Remove the Lambda's S3 write permissions
2. Invoke the Lambda manually

**Expected results**:
- `Errors` metric spikes
- **Drata**: controls mapped to this connection flip to `failing_evidence` within 1–2 run cycles
- **SNS** dead-letter queue holds the unprocessed message

---

## 11. Cost Estimate (Monthly)

Assumptions: 1 Lambda invocation/hour, 5 endpoints, average 200KB/payload, us-east-1.

| Service | Usage | Cost/Month |
|---------|-------|------------|
| Lambda (256MB, 15s avg, 720 invocations) | ~3 GB-s | $0.05 |
| S3 (5 GB storage + 720 PUTs) | ~$0.12/GB | $0.60 |
| SNS (720 publishes + 720 deliveries) | 0.00144M messages | ~$0.00 |
| Secrets Manager (1 secret) | 1 secret * 30 days | $0.40 |
| CloudWatch Logs (~10KB/run = 7MB) | 7MB ingested | $0.35 |
| CloudWatch Alarms (4 alarms) | 4 alarms | $0.40 |
| Data transfer (out to Drata) | Negligible | ~$0.00 |
| **Total** | | **~$1.80/month** |

> **Note**: If the Drata receiver is a separate Lambda (additional ~$0.05) or Snowflake stage (varies), add accordingly. Total system well under $5/month.

---

## 12. Runbook

### Daily Operations
- Check CloudWatch dashboard `RamburCollector` for error rates
- Verify hourly S3 writes via `aws s3 ls` cron or CloudWatch Logs Insights
- Confirm Drata control health in the **Automation** panel

### Incident Response
- **Collector failure**: Check Lambda logs for 5xx/429 errors; verify S1 API token validity; review S3 bucket permissions
- **Drata push failure**: Check Drata API key validity; verify Custom Connection IDs match
- **Missing evidence**: Check S1 API quota; verify the endpoint returns data; check object lock retention hasn't expired
- **Circuit breaker tripped**: Investigate the flapping endpoint; reset breaker manually via parameter store or DynamoDB

### Recovery
- **Failed Drata push**: Re-process the failed S3 files from `drata-push/failed/` prefix
- **Expired token**: Rotate in Secrets Manager; verify IAM permissions; next Lambda run picks up new token automatically
- **Schema violation**: Update JSON Schema in S3 or fix the sender; re-validate and re-publish manually

---

## 13. Appendix: Python Dependencies

`requirements.txt` for the Lambda layer:

```
requests==2.31.0
jsonschema==4.20.0
boto3==1.34.0
structlog==24.1.0
```

Build with `pip install -r requirements.txt -t python/` and package as a Lambda layer.

---

## 14. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-17 | SecOps (opencode_local) | Initial procedure |
