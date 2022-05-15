// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Duration} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Effect, ManagedPolicy, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {ApplicationLoadBalancer, ApplicationTargetGroup} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {ApplicationListener} from 'aws-cdk-lib/aws-elasticloadbalancingv2/lib/alb/application-listener';
import iam = require('aws-cdk-lib/aws-iam');
import lambda = require('aws-cdk-lib/aws-lambda');
import * as path from 'path';

export interface EcsBlueGreenDeploymentHookProps {
    readonly targetGroupX?: ApplicationTargetGroup;
    readonly targetGroupY?: ApplicationTargetGroup;
    readonly alb?: ApplicationLoadBalancer;
    readonly prodListener?: ApplicationListener;
}

export class DeploymentHook {

    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

export class EcsBlueGreenDeploymentHooks extends Construct {

    public readonly deploymentHooks?: DeploymentHook[] = [];
    private readonly httpHeaderName: string = 'counter_no';
    private readonly httpHeaderValueList: string = '88888,99999';

    constructor(scope: Construct, id: string, props: EcsBlueGreenDeploymentHookProps = {}) {
        super(scope, id);

        // IAM role for hook lambda functions
        const customLambdaServiceRole = new iam.Role(this, 'codeDeployHookCustomLambda', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        });

        const inlinePolicyForLambda = new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'codedeploy:PutLifecycleEventHookExecutionStatus',
                'elasticloadbalancing:Describe*',
                'elasticloadbalancing:ModifyListener',
                'elasticloadbalancing:CreateRule',
                'elasticloadbalancing:ModifyRule',
                'elasticloadbalancing:DeleteRule',
                'elasticloadbalancing:SetRulePriorities',
            ],
            resources: ['*']
        });

        customLambdaServiceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
        customLambdaServiceRole.addToPolicy(inlinePolicyForLambda);

        // BeforeInstall hook
        const BeforeInstallLambda = new lambda.Function(this, 'BeforeInstallLambda', {
            code: lambda.Code.fromAsset(
                path.join(__dirname, 'custom_resources'),
                {
                    exclude: ['**', '!before_install.py']
                }),
            runtime: lambda.Runtime.PYTHON_3_8,
            handler: 'before_install.handler',
            role: customLambdaServiceRole,
            functionName: 'blue-green-ecs-before-install',
            description: 'Deployment lifecycle hook to clean up listener rules before install replacement taskset',
            environment: {
                'APP_ALB': props.alb!.loadBalancerArn,
                'ALB_PROD_LISTENER': props.prodListener!.listenerArn
            },
            memorySize: 128,
            timeout: Duration.seconds(60)
        });

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
                'ALB_TG_X': props.targetGroupX!.targetGroupArn,
                'ALB_TG_Y': props.targetGroupY!.targetGroupArn,
                'ALB_PROD_LISTENER': props.prodListener!.listenerArn,
                'HTTP_HEADER_NAME': this.httpHeaderName,
                'HTTP_HEADER_VALUE_LIST': this.httpHeaderValueList
            },
            memorySize: 128,
            timeout: Duration.seconds(60)
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
                'ALB_PROD_LISTENER': props.prodListener!.listenerArn
            },
            memorySize: 128,
            timeout: Duration.seconds(60)
        });

        this.deploymentHooks?.push(new DeploymentHook(BeforeInstallLambda.functionName));
        this.deploymentHooks?.push(new DeploymentHook(afterAllowTestTrafficLambda.functionName));
        this.deploymentHooks?.push(new DeploymentHook(beforeAllowTrafficLambda.functionName));
    }

}
