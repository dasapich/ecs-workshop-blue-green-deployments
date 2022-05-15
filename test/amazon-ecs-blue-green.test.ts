// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Template} from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import * as EcsBlueGreen from '../lib/index';

test('Blue/Green deployment pipeline is created', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'EcsBlueGreenStack');
    // WHEN
    const ecsBlueGreenRoles = new EcsBlueGreen.EcsBlueGreenRoles(stack, 'EcsBlueGreenRoles');
    const ecsBlueGreenBuildImage = new EcsBlueGreen.EcsBlueGreenBuildImage(stack, 'EcsBlueGreenBuildImage', {
        codeBuildRole: ecsBlueGreenRoles.codeBuildRole,
        ecsTaskRole: ecsBlueGreenRoles.ecsTaskRole,
        codeRepoName: 'books',
        codeRepoDesc: 'source code for books API',
        dockerHubUsername: 'username',
        dockerHubPassword: 'password'
    });
    const ecsBlueGreenCluster = new EcsBlueGreen.EcsBlueGreenCluster(stack, 'EcsBlueGreenCluster', {
        cidr: '10.0.0.0/16'
    });
    new EcsBlueGreen.EcsBlueGreenPipeline(stack, 'EcsBlueGreenPipeline', {
        apiName: 'books',
        deploymentConfigName: 'CodeDeployDefault.ECSLinear10PercentEvery1Minutes',
        cluster: ecsBlueGreenCluster.cluster,
        vpc: ecsBlueGreenCluster.vpc,
        containerPort: 9000,
        ecrRepoName: ecsBlueGreenBuildImage.ecrRepo.repositoryName,
        codeBuildProjectName: ecsBlueGreenBuildImage.codeBuildProject.projectName,
        codeRepoName: 'books',
        ecsTaskRoleArn: ecsBlueGreenRoles.ecsTaskRole.roleArn,
        taskSetTerminationTimeInMinutes: 10
    })

    // THEN
    Template.fromStack(stack).resourceCountIs('AWS::IAM::Role', 11);
    Template.fromStack(stack).resourceCountIs('AWS::ECR::Repository', 1);
    Template.fromStack(stack).resourceCountIs('AWS::CodeCommit::Repository', 1);
    Template.fromStack(stack).resourceCountIs('AWS::CodeBuild::Project', 1);
    Template.fromStack(stack).resourceCountIs('AWS::EC2::VPC', 1);
    Template.fromStack(stack).resourceCountIs('AWS::ECS::Cluster', 1);
    Template.fromStack(stack).resourceCountIs('AWS::ECS::TaskDefinition', 1);
    Template.fromStack(stack).resourceCountIs('AWS::ECS::Service', 1);
    Template.fromStack(stack).resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 2);
    Template.fromStack(stack).resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 3);
    Template.fromStack(stack).resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 3);
    Template.fromStack(stack).resourceCountIs('AWS::CloudWatch::Alarm', 4);
});
