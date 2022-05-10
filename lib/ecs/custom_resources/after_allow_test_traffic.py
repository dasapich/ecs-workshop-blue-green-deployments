# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

SUCCESS = "Succeeded"
FAILED = "Failed"
default_rule_priority = 10

# Configure logging
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.DEBUG)

codedeploy_client = boto3.client("codedeploy")
alb_client = boto3.client("elbv2")

alb = os.environ["APP_ALB"]
alb_prod_listener = os.environ["ALB_PROD_LISTENER"]
alb_tg_x = os.environ["ALB_TG_X"]
alb_tg_y = os.environ["ALB_TG_Y"]
http_header_name = os.environ["HTTP_HEADER_NAME"]
http_header_values = [v for v in os.environ["HTTP_HEADER_VALUE_LIST"].split(",") if v]

# Lambda Handler
def handler(event, context):
    LOGGER.info("Received event: " + json.dumps(event, indent=2))
    LOGGER.info("Entering AfterAllowTestTraffic hook.")

    deployment_id = event["DeploymentId"]
    life_cycle_event_hook_execution_id = event["LifecycleEventHookExecutionId"]
    hook_status = FAILED

    try:
        # Figure out which target group has the Green tasks
        blue_tg = get_blue_target_group(alb_prod_listener)
        if blue_tg != alb_tg_x and blue_tg != alb_tg_y:
            raise Exception(
                "Current PROD target group {} doesn't match either {} or {}".format(
                    blue_tg, alb_tg_x, alb_tg_y
                )
            )
        if blue_tg == alb_tg_x:
            green_tg = alb_tg_y
        else:
            green_tg = alb_tg_x

        # Remove all non-default rules on the listener
        remove_routing_rules(listener_arn=alb_prod_listener)

        # Add custom http-header routing rule
        add_http_header_request_routing_rule(
            listener_arn=alb_prod_listener,
            priority=default_rule_priority,
            target_group_arn=green_tg,
            http_header_name=http_header_name,
            http_header_values=http_header_values,
        )

        hook_status = SUCCESS
    except BaseException as e:
        LOGGER.error("AfterAllowTestTraffic hook failed with error: " + str(e))
    finally:
        send_status(deployment_id, life_cycle_event_hook_execution_id, hook_status)


def get_blue_target_group(listener_arn):
    """
    Get the current Blue (PROD) target group.
    Queries the PROD listener to retrieve the target group from the default action.

    :param listener_arn: The ALB listener Amazon Resource Name (ARN).
    :return: The target group ARN from the listener default action.
    """
    LOGGER.info(
        "Retrieve PROD target group for ALB {} PROD listener {}".format(
            alb,
            alb_prod_listener,
        )
    )
    try:
        response = alb_client.describe_listeners(ListenerArns=[listener_arn])
        target_group = response["Listeners"][0]["DefaultActions"][0]["TargetGroupArn"]
    except ClientError as err:
        LOGGER.error(
            "Error getting PROD listener information {}: {}".format(
                err.response["Error"]["Code"], err.response["Error"]["Message"]
            )
        )
        raise err

    return target_group


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


def add_http_header_request_routing_rule(
    listener_arn,
    priority,
    target_group_arn,
    http_header_name,
    http_header_values,
):
    """
    Adds advanced request routing rule to the ALB listener.

    :param listener_arn: ARN of the ALB listener to add the rule to.
    :param priority: Rule integer priority value.
    :param target_group_arn: ARN of the target group to forward traffic to.
    :param http_header_name: The name of the HTTP header field.
    :param http_header_values: List of HTTP header string values.
    """
    LOGGER.info("Add ALB rule to listener {}".format(listener_arn))
    try:
        response = alb_client.create_rule(
            ListenerArn=listener_arn,
            Priority=priority,
            Conditions=[
                {
                    "Field": "http-header",
                    "HttpHeaderConfig": {
                        "HttpHeaderName": http_header_name,
                        "Values": http_header_values,
                    },
                }
            ],
            Actions=[
                {
                    "Type": "forward",
                    "TargetGroupArn": target_group_arn,
                }
            ],
        )
    except ClientError as err:
        LOGGER.error(
            "Error adding listener rule {}: {}".format(
                err.response["Error"]["Code"], err.response["Error"]["Message"]
            )
        )
        raise err

    LOGGER.info("ALB listener rules :" + json.dumps(response, indent=2))


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
            "AfterAllowTestTraffic {} {}".format(
                hook_status,
                response["lifecycleEventHookExecutionId"],
            )
        )

    except BaseException as e:
        LOGGER.info("AfterAllowTestTraffic failed")
        LOGGER.error(str(e))
