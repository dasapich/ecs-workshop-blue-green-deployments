// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from '@aws-cdk/core';
import {Effect, ManagedPolicy, ServicePrincipal} from '@aws-cdk/aws-iam';
import * as path from 'path';
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import {ApplicationLoadBalancer, ApplicationTargetGroup} from '@aws-cdk/aws-elasticloadbalancingv2';
import {ApplicationListener} from '@aws-cdk/aws-elasticloadbalancingv2/lib/alb/application-listener';

export interface EcsBlueGreenDeploymentHookProps {
    readonly blueTargetGroup?: ApplicationTargetGroup;
    readonly greenTargetGroup?: ApplicationTargetGroup;
    readonly alb?: ApplicationLoadBalancer;
    readonly prodListener?: ApplicationListener;
}

export class DeploymentHook {

    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

export class EcsBlueGreenDeploymentHooks extends cdk.Construct {

    public readonly deploymentHooks?: DeploymentHook[] = [];

    constructor(scope: cdk.Construct, id: string, props: EcsBlueGreenDeploymentHookProps = {}) {
        super(scope, id);

        // IAM role for hook lambda functions
        const customLambdaServiceRole = new iam.Role(this, 'codeDeployHookCustomLambda', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        });

        const inlinePolicyForLambda = new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'codedeploy:PutLifecycleEventHookExecutionStatus'
            ],
            resources: ['*']
        });

        customLambdaServiceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
        customLambdaServiceRole.addToPolicy(inlinePolicyForLambda);

        // AfterAllowTestTraffic hook
        const afterAllowTestTrafficLambda = new lambda.Function(this, 'afterAllowTestTrafficLambda', {
            code: lambda.Code.fromAsset(
                path.join(__dirname, 'custom_resources'),
                {
                    exclude: ['**', '!after_allow_test_traffic.py']
                }),
            runtime: lambda.Runtime.PYTHON_3_8,
            handler: 'after_allow_test_traffic.handler',
            role: customLambdaServiceRole,
            functionName: 'blue-green-ecs-after-allow-test-traffic',
            description: 'Deployment lifecycle hook for testing',
            environment: {
                'APP_ALB': props.alb!.loadBalancerArn,
                'ALB_BLUE_TG': props.blueTargetGroup!.targetGroupArn,
                'ALB_GREEN_TG': props.greenTargetGroup!.targetGroupArn,
                'ALB_PROD_LISTENER': props.prodListener!.listenerArn
            },
            memorySize: 128,
            timeout: cdk.Duration.seconds(60)
        });

        // BeforeAllowTraffic hook
        const beforeAllowTrafficLambda = new lambda.Function(this, 'beforeAllowTrafficLambda', {
            code: lambda.Code.fromAsset(
                path.join(__dirname, 'custom_resources'),
                {
                    exclude: ['**', '!before_allow_traffic.py']
                }),
            runtime: lambda.Runtime.PYTHON_3_8,
            handler: 'before_allow_traffic.handler',
            role: customLambdaServiceRole,
            functionName: 'blue-green-ecs-before-allow-traffic',
            description: 'Deployment lifecycle hook to clean up tests',
            environment: {
                'APP_ALB': props.alb!.loadBalancerArn,
                'ALB_BLUE_TG': props.blueTargetGroup!.targetGroupArn,
                'ALB_GREEN_TG': props.greenTargetGroup!.targetGroupArn,
                'ALB_PROD_LISTENER': props.prodListener!.listenerArn
            },
            memorySize: 128,
            timeout: cdk.Duration.seconds(60)
        });

        this.deploymentHooks?.push(new DeploymentHook(afterAllowTestTrafficLambda.functionName));
        this.deploymentHooks?.push(new DeploymentHook(beforeAllowTrafficLambda.functionName));
    }

}
