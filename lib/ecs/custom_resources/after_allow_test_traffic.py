# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import logging

import boto3

SUCCESS = "Succeeded"
FAILED = "Failed"

# Configure logging
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.DEBUG)

codedeploy_client = boto3.client("codedeploy")
alb_client = boto3.client("elbv2")

# Lambda Handler
def handler(event, context):
    LOGGER.info("Received event: " + json.dumps(event, indent=2))
    LOGGER.info("Entering AfterAllowTestTraffic hook.")

    deployment_id = event["DeploymentId"]
    life_cycle_event_hook_execution_id = event["LifecycleEventHookExecutionId"]
    validation_test_result = FAILED

    LOGGER.info("This is where AfterAllowTestTraffic validation tests happen.")
    validation_test_result = SUCCESS

    try:
        response = codedeploy_client.put_lifecycle_event_hook_execution_status(
            deploymentId=deployment_id,
            lifecycleEventHookExecutionId=life_cycle_event_hook_execution_id,
            status=validation_test_result,
        )
        LOGGER.info(
            "AfterAllowTestTraffic tests succeeded {}".format(
                response["lifecycleEventHookExecutionId"]
            )
        )

    except BaseException as e:
        LOGGER.info("AfterAllowTestTraffic validation tests failed")
        LOGGER.error(str(e))
