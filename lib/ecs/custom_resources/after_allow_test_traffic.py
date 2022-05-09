# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import logging
import os

import boto3

SUCCESS = "Succeeded"
FAILED = "Failed"

# Configure logging
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.DEBUG)

codedeploy_client = boto3.client("codedeploy")
alb_client = boto3.client("elbv2")

alb = os.environ["APP_ALB"]
alb_prod_listener = os.environ["ALB_PROD_LISTENER"]
alb_blue_tg = os.environ["ALB_BLUE_TG"]
alb_green_tg = os.environ["ALB_GREEN_TG"]

# Lambda Handler
def handler(event, context):
    LOGGER.info("Received event: " + json.dumps(event, indent=2))
    LOGGER.info("Entering AfterAllowTestTraffic hook.")

    deployment_id = event["DeploymentId"]
    life_cycle_event_hook_execution_id = event["LifecycleEventHookExecutionId"]
    test_result = FAILED

    LOGGER.info("Describe the PROD listener rules.")
    try:
        response = alb_client.describe_rules(ListenerArn=alb_prod_listener)
        test_result = SUCCESS
        LOGGER.info(
            "Info:\n\tALB {}\n\tListener {}\n\tBlueTG {}\n\tGreenTG {}".format(
                alb,
                alb_prod_listener,
                alb_blue_tg,
                alb_green_tg,
            )
        )
        LOGGER.info("Current rules: " + json.dumps(response, indent=2))
    except BaseException as e:
        LOGGER.error(
            "Create rule failed on ALB {} / Listener {}".format(
                alb,
                alb_prod_listener,
            )
            + str(e)
        )
    finally:
        send_status(deployment_id, life_cycle_event_hook_execution_id, test_result)


def send_status(deployment_id, life_cycle_event_hook_execution_id, test_result):
    LOGGER.info("Sending back lifecycle hook status.")
    try:
        response = codedeploy_client.put_lifecycle_event_hook_execution_status(
            deploymentId=deployment_id,
            lifecycleEventHookExecutionId=life_cycle_event_hook_execution_id,
            status=test_result,
        )
        LOGGER.info(
            "AfterAllowTestTraffic {} {}".format(
                test_result,
                response["lifecycleEventHookExecutionId"],
            )
        )

    except BaseException as e:
        LOGGER.info("AfterAllowTestTraffic failed")
        LOGGER.error(str(e))
