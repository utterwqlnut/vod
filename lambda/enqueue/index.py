import json
import os

import boto3

sqs = boto3.client("sqs")
QUEUE_URL = os.environ["QUEUE_URL"]


def handler(event, _context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps({"bucket": bucket, "key": key}),
        )
    return {"statusCode": 200, "body": "ok"}
