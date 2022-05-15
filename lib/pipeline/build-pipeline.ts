// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from 'constructs';
import {CfnOutput} from 'aws-cdk-lib';
import {AnyPrincipal, Effect, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {BlockPublicAccess, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {EcsBlueGreenDeploymentGroup, EcsBlueGreenService, EcsServiceAlarms, EcsBlueGreenDeploymentHooks} from '..';
import {ICluster} from 'aws-cdk-lib/aws-ecs';
import {IVpc} from 'aws-cdk-lib/aws-ec2';
import {AlbTarget} from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import iam = require('aws-cdk-lib/aws-iam');
import s3 = require('aws-cdk-lib/aws-s3');
import ecr = require('aws-cdk-lib/aws-ecr');
import elb = require('aws-cdk-lib/aws-elasticloadbalancingv2');
import api = require('aws-cdk-lib/aws-apigateway');
import codeCommit = require('aws-cdk-lib/aws-codecommit');
import codeBuild = require('aws-cdk-lib/aws-codebuild');
import codePipeline = require('aws-cdk-lib/aws-codepipeline');
import codePipelineActions = require('aws-cdk-lib/aws-codepipeline-actions');


export interface EcsBlueGreenPipelineProps {
    readonly codeRepoName?: string;
    readonly ecrRepoName?: string;
    readonly codeBuildProjectName?: string;
    readonly ecsTaskRoleArn?: string;
    readonly containerPort?: number;
    readonly apiName?: string;
    readonly vpc?: IVpc;
    readonly cluster?: ICluster;
    readonly taskSetTerminationTimeInMinutes?: number;
    readonly deploymentReadyWaitTimeinMinutes?: number;
    readonly deploymentConfigName?: string;
}

export class EcsBlueGreenPipeline extends Construct {

    constructor(scope: Construct, id: string, props: EcsBlueGreenPipelineProps = {}) {
        super(scope, id);

        const codeRepo = codeCommit.Repository.fromRepositoryName(this, 'codeRepo', props.codeRepoName!);
        const ecrRepo = ecr.Repository.fromRepositoryName(this, 'ecrRepo', props.ecrRepoName!);
        const codeBuildProject = codeBuild.Project.fromProjectName(this, 'codeBuild', props.codeBuildProjectName!);
        const ecsTaskRole = iam.Role.fromRoleArn(this, 'ecsTaskRole', props.ecsTaskRoleArn!);

        const codePipelineRole = new iam.Role(this, 'codePipelineRole', {
            assumedBy: new ServicePrincipal('codepipeline.amazonaws.com')
        });

        const codePipelinePolicy = new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'iam:PassRole',
                'sts:AssumeRole',
                'codecommit:Get*',
                'codecommit:List*',
                'codecommit:GitPull',
                'codecommit:UploadArchive',
                'codecommit:CancelUploadArchive',
                'codebuild:BatchGetBuilds',
                'codebuild:StartBuild',
                'codedeploy:CreateDeployment',
                'codedeploy:Get*',
                'codedeploy:RegisterApplicationRevision',
                's3:Get*',
                's3:List*',
                's3:PutObject'
            ],
            resources: ['*']
        });

        codePipelineRole.addToPolicy(codePipelinePolicy);

        const sourceArtifact = new codePipeline.Artifact('sourceArtifact');
        const buildArtifact = new codePipeline.Artifact('buildArtifact');

        // S3 bucket for storing the code pipeline artifacts
        const artifactsBucket = new s3.Bucket(this, 'artifactsBucket', {
            encryption: BucketEncryption.S3_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL
        });

        // S3 bucket policy for the code pipeline artifacts
        const denyUnEncryptedObjectUploads = new iam.PolicyStatement({
            effect: Effect.DENY,
            actions: ['s3:PutObject'],
            principals: [new AnyPrincipal()],
            resources: [artifactsBucket.bucketArn.concat('/*')],
            conditions: {
                StringNotEquals: {
                    's3:x-amz-server-side-encryption': 'aws:kms'
                }
            }
        });

        const denyInsecureConnections = new iam.PolicyStatement({
            effect: Effect.DENY,
            actions: ['s3:*'],
            principals: [new AnyPrincipal()],
            resources: [artifactsBucket.bucketArn.concat('/*')],
            conditions: {
                Bool: {
                    'aws:SecureTransport': 'false'
                }
            }
        });

        artifactsBucket.addToResourcePolicy(denyUnEncryptedObjectUploads);
        artifactsBucket.addToResourcePolicy(denyInsecureConnections);

        const ecsBlueGreenService = new EcsBlueGreenService(this, 'service', {
            containerPort: props.containerPort,
            apiName: props.apiName,
            ecrRepository: ecrRepo,
            ecsTaskRole: ecsTaskRole,
            vpc: props.vpc,
            cluster: props.cluster
        });

        const ecsServiceAlarms = new EcsServiceAlarms(this, 'alarms', {
            alb: ecsBlueGreenService.alb,
            blueTargetGroup: ecsBlueGreenService.blueTargetGroup,
            greenTargetGroup: ecsBlueGreenService.greenTargetGroup,
            apiName: props.apiName
        });

        const ecsBlueGreenDeploymentGroup = new EcsBlueGreenDeploymentGroup(this, 'ecsApplication', {
            ecsClusterName: props.cluster?.clusterName,
            ecsServiceName: ecsBlueGreenService.ecsService.serviceName,
            prodListenerArn: ecsBlueGreenService.albProdListener.listenerArn,
            testListenerArn: ecsBlueGreenService.albTestListener.listenerArn,
            blueTargetGroupName: ecsBlueGreenService.blueTargetGroup.targetGroupName,
            greenTargetGroupName: ecsBlueGreenService.greenTargetGroup.targetGroupName,
            terminationWaitTime: props.taskSetTerminationTimeInMinutes,
            deploymentReadyWaitTime: props.deploymentReadyWaitTimeinMinutes,
            deploymentConfigName: props.deploymentConfigName,
            deploymentGroupName: props.apiName,
            targetGroupAlarms: ecsServiceAlarms.targetGroupAlarms
        });

        // Blue/Green delployment lifecycle hooks
        const ecsBlueGreenDeploymentHooks = new EcsBlueGreenDeploymentHooks(this, 'hooks', {
            alb: ecsBlueGreenService.alb,
            targetGroupX: ecsBlueGreenService.blueTargetGroup,
            targetGroupY: ecsBlueGreenService.greenTargetGroup,
            prodListener: ecsBlueGreenService.albProdListener
        });

        // Code Pipeline - CloudWatch trigger event is created by CDK
        const pipeline = new codePipeline.Pipeline(this, 'ecsBlueGreen', {
            role: codePipelineRole,
            artifactBucket: artifactsBucket,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codePipelineActions.CodeCommitSourceAction({
                            actionName: 'Source',
                            repository: codeRepo,
                            output: sourceArtifact,
                            branch: 'main'
                        }),
                    ]
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codePipelineActions.CodeBuildAction({
                            actionName: 'Build',
                            project: codeBuildProject,
                            input: sourceArtifact,
                            outputs: [buildArtifact]
                        })
                    ]
                },
                {
                    stageName: 'Deploy',
                    actions: [
                        new codePipelineActions.CodeDeployEcsDeployAction({
                            actionName: 'Deploy',
                            deploymentGroup: ecsBlueGreenDeploymentGroup.ecsDeploymentGroup,
                            appSpecTemplateInput: buildArtifact,
                            taskDefinitionTemplateInput: buildArtifact,
                        })
                    ]
                }
            ]
        });

        pipeline.node.addDependency(ecsBlueGreenDeploymentGroup);

        // Create NLB to forward requests from API Gateway VPC link to the service ALB
        const nlb = new elb.NetworkLoadBalancer(this, 'nlb', {
            vpc: props.vpc!,
        });
        const nlbListener = nlb.addListener('nlbListener', { port: 80 });
        const nlbAlbTargetGroup = new elb.NetworkTargetGroup(this, 'nlbAlbTargetGroup', {
            port: 80,
            targetType: elb.TargetType.ALB,
            vpc: props.vpc!,
            targets: [
                new AlbTarget(ecsBlueGreenService.alb, 80),
            ],
            healthCheck: {
                protocol: elb.Protocol.HTTP,
            },
        });
        nlbListener.addTargetGroups('albTargetGroup', nlbAlbTargetGroup);

        nlbAlbTargetGroup.node.addDependency(ecsBlueGreenService.alb.listeners[0]);
            
        // API Gateway VPC Link
        const apiGatewayVpcLink = new api.VpcLink(this, 'apiGatewayVpcLink', {
            targets: [nlb],
        });
        // Creat a REST API
        const apiGateway = new api.RestApi(this, 'apiGateway', {
            description: 'API for custom Blue/Green/Canary deployment testing',
        });
        apiGateway.root.addMethod(
            'GET',
            new api.HttpIntegration(
                'http://' + nlb.loadBalancerDnsName,
                {
                    httpMethod: 'GET',
                    options: {
                        connectionType: api.ConnectionType.VPC_LINK,
                        vpcLink: apiGatewayVpcLink,
                    },
                },
            )
        );
        apiGateway.root.addMethod(
            'POST',
             new api.HttpIntegration(
                'http://' + nlb.loadBalancerDnsName,
                {
                    httpMethod: 'POST',
                    options: {
                        connectionType: api.ConnectionType.VPC_LINK,
                        vpcLink: apiGatewayVpcLink,
                    },
                },
            )
        );
        const noteEdit = apiGateway.root.addResource('edit');
        const note = noteEdit.addResource('{note_id}');
        note.addMethod(
            'GET',
            new api.HttpIntegration(
                'http://' + nlb.loadBalancerDnsName + '/edit/{note_id}',
                {
                    httpMethod: 'GET',
                    options: {
                        connectionType: api.ConnectionType.VPC_LINK,
                        vpcLink: apiGatewayVpcLink,
                    },
                },
            )
        );
        note.addMethod(
            'POST',
            new api.HttpIntegration(
                'http://' + nlb.loadBalancerDnsName + '/edit/{note_id}',
                {
                    httpMethod: 'POST',
                    options: {
                        connectionType: api.ConnectionType.VPC_LINK,
                        vpcLink: apiGatewayVpcLink,
                    },
                },
            )
        );

        // Export the outputs
        new CfnOutput(this, 'ecsBlueGreenLBDns', {
            description: 'Internal ALB DNS',
            exportName: 'ecsBlueGreenLBDns',
            value: ecsBlueGreenService.alb.loadBalancerDnsName
        });

        new CfnOutput(this, 'nlbDns', {
            description: 'NLB DNS',
            exportName: 'nlbDns',
            value: nlb.loadBalancerDnsName
        });

         new CfnOutput(this, 'apiGatewayDns', {
            description: 'API Gateway DNS',
            exportName: 'apiGatewayDns',
            value: apiGateway.url
        });

   }

}
