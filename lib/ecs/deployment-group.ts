// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from 'constructs';
import {CustomResource, Duration} from 'aws-cdk-lib';
import {Effect, ManagedPolicy, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import {EcsDeploymentConfig, IEcsDeploymentGroup} from 'aws-cdk-lib/aws-codedeploy';
import {TargetGroupAlarm} from './alarms';
import codeDeploy = require('aws-cdk-lib/aws-codedeploy');
import iam = require('aws-cdk-lib/aws-iam');
import lambda = require('aws-cdk-lib/aws-lambda');

export interface EcsBlueGreenDeploymentGroupProps {

    /**
     * The physical, human-readable name of the CodeDeploy Deployment Group.
     *
     */
    readonly deploymentGroupName?: string;

    /**
     * The Deployment Configuration this Deployment Group uses.
     *
     */
    readonly deploymentConfigName?: string;

    /**
     * The termination wait time for the ECS TaskSet
     *
     */
    readonly terminationWaitTime?: number;

    /**
     * The deployment ready wait time
     *
     */
    readonly deploymentReadyWaitTime?: number;


    /**
     * Blue target group name
     */
    readonly blueTargetGroupName?: string;

    /**
     * Green target group name
     */
    readonly greenTargetGroupName?: string;

    /**
     * Target group alarm names
     */
    readonly targetGroupAlarms?: TargetGroupAlarm[];

    /**
     * Production listener ARN
     */
    readonly prodListenerArn?: string;

    /**
     * Test listener ARN
     */
    readonly testListenerArn?: string;

    /**
     * ECS cluster name
     */
    readonly ecsClusterName?: string;

    /**
     * ECS service name
     */
    readonly ecsServiceName?: string;

}

export class EcsBlueGreenDeploymentGroup extends Construct {

    public readonly ecsDeploymentGroup: IEcsDeploymentGroup;

    constructor(scope: Construct, id: string, props: EcsBlueGreenDeploymentGroupProps = {}) {
        super(scope, id);

        // Creating the ecs application
        const ecsApplication = new codeDeploy.EcsApplication(this, 'ecsApplication');

        // Creating the code deploy service role
        const codeDeployServiceRole = new iam.Role(this, 'ecsCodeDeployServiceRole', {
            assumedBy: new ServicePrincipal('codedeploy.amazonaws.com')
        });

        codeDeployServiceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECS'));

        // IAM role for custom lambda function
        const customLambdaServiceRole = new iam.Role(this, 'codeDeployCustomLambda', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        });

        const inlinePolicyForLambda = new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'iam:PassRole',
                'sts:AssumeRole',
                'codedeploy:List*',
                'codedeploy:Get*',
                'codedeploy:UpdateDeploymentGroup',
                'codedeploy:CreateDeploymentGroup',
                'codedeploy:DeleteDeploymentGroup'
            ],
            resources: ['*']
        });

        customLambdaServiceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))
        customLambdaServiceRole.addToPolicy(inlinePolicyForLambda);

        // Custom resource to create the deployment group
        const createDeploymentGroupLambda = new lambda.Function(this, 'createDeploymentGroupLambda', {
            code: lambda.Code.fromAsset(
                path.join(__dirname, 'custom_resources'),
                {
                    exclude: ['**', '!create_deployment_group.py']
                }),
            runtime: lambda.Runtime.PYTHON_3_8,
            handler: 'create_deployment_group.handler',
            role: customLambdaServiceRole,
            description: 'Custom resource to create ECS deployment group',
            memorySize: 128,
            timeout: Duration.seconds(60)
        });

        new CustomResource(this, 'customEcsDeploymentGroup', {
            serviceToken: createDeploymentGroupLambda.functionArn,
            properties: {
                ApplicationName: ecsApplication.applicationName,
                DeploymentGroupName: props.deploymentGroupName,
                DeploymentConfigName: props.deploymentConfigName,
                ServiceRoleArn: codeDeployServiceRole.roleArn,
                BlueTargetGroup: props.blueTargetGroupName,
                GreenTargetGroup: props.greenTargetGroupName,
                ProdListenerArn: props.prodListenerArn,
                TestListenerArn: props.testListenerArn,
                TargetGroupAlarms: JSON.stringify(props.targetGroupAlarms),
                EcsClusterName: props.ecsClusterName,
                EcsServiceName: props.ecsServiceName,
                TerminationWaitTime: props.terminationWaitTime,
                DeploymentReadyWaitTime: props.deploymentReadyWaitTime
            }
        });

        this.ecsDeploymentGroup = codeDeploy.EcsDeploymentGroup.fromEcsDeploymentGroupAttributes(this, 'ecsDeploymentGroup', {
            application: ecsApplication,
            deploymentGroupName: props.deploymentGroupName!,
            deploymentConfig: EcsDeploymentConfig.fromEcsDeploymentConfigName(this, 'ecsDeploymentConfig', props.deploymentConfigName!)
        });

    }


}
