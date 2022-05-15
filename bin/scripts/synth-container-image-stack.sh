#!/usr/bin/env bash

######################################################################
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved. #
# SPDX-License-Identifier: MIT-0                                     #
######################################################################

GREEN="\033[1;32m"
YELLOW="\033[1;33m"

#############################################################################
# Container image resources
##############################################################################
echo -e "${GREEN}Start synthing the container image stack resources...."

export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_DEFAULT_REGION=$(aws configure get region)
export CODE_REPO_NAME=app-demo

npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_DEFAULT_REGION

npx cdk --app "npx ts-node bin/container-image-stack.ts" synth

echo -e "${GREEN}Completed synthing the container image stack resources...."

