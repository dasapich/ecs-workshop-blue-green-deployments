#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {CfnParameter, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as EcsBlueGreen from '../lib';

export class BlueGreenPipelineStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const deploymentConfigName = new CfnParameter(this, 'deploymentConfigName', {
            type: 'String',
            default: 'CodeDeployDefault.ECSLinear10PercentEvery1Minutes',
            allowedValues: [
                'CodeDeployDefault.ECSLinear10PercentEvery1Minutes',
                'CodeDeployDefault.ECSLinear10PercentEvery3Minutes',
                'CodeDeployDefault.ECSCanary10Percent5Minutes',
                'CodeDeployDefault.ECSCanary10Percent15Minutes',
                'CodeDeployDefault.ECSAllAtOnce'
            ],
            description: 'Shifts x percentage of traffic every x minutes until all traffic is shifted',
        });

        const taskSetTerminationTimeInMinutes = new CfnParameter(this, 'taskSetTerminationTimeInMinutes', {
            type: 'Number',
            default: '10',
            description: 'TaskSet termination time in minutes',
        });

        const deploymentReadyWaitTimeinMinutes = new CfnParameter(this, 'deploymentReadyWaitTimeinMinutes', {
            type: 'Number',
            default: '0',
            description: 'Minutes to wait before deployment status changed to Stopped if rerouting is not started manually'
        })

        // Build the stack
        const ecsBlueGreenCluster = new EcsBlueGreen.EcsBlueGreenCluster(this, 'EcsBlueGreenCluster', {
            cidr: process.env.CIDR_RANGE
        });

        new EcsBlueGreen.EcsBlueGreenPipeline(this, 'EcsBlueGreenPipeline', {
            apiName: process.env.API_NAME,
            deploymentConfigName: deploymentConfigName.valueAsString,
            cluster: ecsBlueGreenCluster.cluster,
            vpc: ecsBlueGreenCluster.vpc,
            containerPort: Number(process.env.CONTAINER_PORT),
            ecrRepoName: process.env.ECR_REPO_NAME,
            codeBuildProjectName: process.env.CODE_BUILD_PROJECT_NAME,
            codeRepoName: process.env.CODE_REPO_NAME,
            ecsTaskRoleArn: process.env.ECS_TASK_ROLE_ARN,
            taskSetTerminationTimeInMinutes: taskSetTerminationTimeInMinutes.valueAsNumber,
            deploymentReadyWaitTimeinMinutes: deploymentReadyWaitTimeinMinutes.valueAsNumber
        })
    }
}


const app = new cdk.App();
new BlueGreenPipelineStack(app, 'BlueGreenPipelineStack', {
    description: 'Builds the blue/green deployment pipeline stack'
});
