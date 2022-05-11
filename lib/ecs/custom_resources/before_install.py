# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

SUCCESS = "Succeeded"
FAILED = "Failed"

# Configure logging
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.DEBUG)

codedeploy_client = boto3.client("codedeploy")
alb_client = boto3.client("elbv2")

alb = os.environ["APP_ALB"]
alb_prod_listener = os.environ["ALB_PROD_LISTENER"]

# Lambda Handler
def handler(event, context):
    LOGGER.info("Received event: " + json.dumps(event, indent=2))
    LOGGER.info("Entering BeforeAllowTraffic hook.")

    deployment_id = event["DeploymentId"]
    life_cycle_event_hook_execution_id = event["LifecycleEventHookExecutionId"]
    hook_status = FAILED

    try:
        # Remove all non-default rules on the listener
        remove_routing_rules(listener_arn=alb_prod_listener)
        LOGGER.info(
            "Removed all rules on ALB {} PROD listener {}".format(
                alb, alb_prod_listener
            )
        )

        hook_status = SUCCESS
    except BaseException as e:
        LOGGER.error("BeforeAllowTraffic hook failed with error: " + str(e))
    finally:
        send_status(deployment_id, life_cycle_event_hook_execution_id, hook_status)


def remove_routing_rules(listener_arn):
    """
    Removes all non-default rules on the ALB listener.

    :param listener_arn: ARN of the ALB listener.
    """
    LOGGER.info("Remove all non-default rules on listener {}".format(listener_arn))
    try:
        response = alb_client.describe_rules(ListenerArn=listener_arn)
        LOGGER.info("Current listener rules :" + json.dumps(response, indent=2))
    except ClientError as err:
        LOGGER.error(
            "Error getting listener rules {}: {}".format(
                err.response["Error"]["Code"], err.response["Error"]["Message"]
            )
        )
        raise err

    try:
        for rule in response["Rules"]:
            if rule["IsDefault"]:
                LOGGER.info("Skip default rule:" + json.dumps(rule, indent=2))
                continue
            rule_arn = rule["RuleArn"]
            LOGGER.info("Removing {}".format(rule_arn) + json.dumps(rule, indent=2))
            remove_response = alb_client.delete_rule(RuleArn=rule_arn)
            LOGGER.info("Remaining rules :" + json.dumps(remove_response, indent=2))
    except ClientError as err:
        LOGGER.error(
            "Error removing rules {}: {}".format(
                err.response["Error"]["Code"], err.response["Error"]["Message"]
            )
        )
        raise err

    LOGGER.info("Remove all rules done")


def send_status(deployment_id, life_cycle_event_hook_execution_id, hook_status):
    """
    Sends back the lifecycle hook status to AWS CodeDeploy[

    :param deployment_id: The AWS CodeDeploy deployment ID.
    :param life_cycle_event_hook_execution_id: The event hook execution ID.
    :param hook_status: The hook status to send back to AWS CodeDeploy.
    """
    LOGGER.info("Sending back lifecycle hook status.")
    try:
        response = codedeploy_client.put_lifecycle_event_hook_execution_status(
            deploymentId=deployment_id,
            lifecycleEventHookExecutionId=life_cycle_event_hook_execution_id,
            status=hook_status,
        )
        LOGGER.info(
            "BeforeAllowTraffic {} {}".format(
                hook_status,
                response["lifecycleEventHookExecutionId"],
            )
        )

    except BaseException as e:
        LOGGER.info("BeforeAllowTraffic failed")
        LOGGER.error(str(e))
