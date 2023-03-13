import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import type { graphql as GraphQl } from '@octokit/graphql/dist-types/types'
import {
  Organization,
  ProjectV2SingleSelectField,
  UpdateProjectV2ItemFieldValueInput,
  Issue,
  Maybe,
  ProjectV2,
  ProjectV2Item
} from '@octokit/graphql-schema'

export enum Status {
  Review = 'Review',
  InProgress = 'In Progress',
  Test = 'Test'
}

/**
 * Updates the given issue in the given project to the given status.
 */
export async function updateIssueStatus(
  issueNumber: number,
  projectNumber: number,
  status: Status
): Promise<void> {
  core.info(`Updating status for issue #${issueNumber} to ${status}...`)

  const graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${core.getInput('token')}`
    }
  })

  const project = await fetchProjectInformation(graphqlWithAuth, projectNumber);

  const projectId = project?.id

  const statusField = project?.fields.nodes?.find(
    x => x?.name === 'Status'
  ) as ProjectV2SingleSelectField
  const statusFieldId = statusField?.id
  core.info(`Found field ID ${statusFieldId} for status field`)

  const statusOptionId = statusField?.options.find(x =>
    x.name.includes(status)
  )?.id
  core.info(`Found option ID ${statusOptionId} for status ${status}`);

  const issues = await fetchIssuesInProject(graphqlWithAuth, projectNumber);
  const projectIssueId = issues.find(
    x => (x?.content as Issue).number === issueNumber
  )?.id
  core.info(`Found project issue with ID ${projectIssueId} for issue #${issueNumber}`);

  if (statusFieldId && statusOptionId && projectId && projectIssueId) {
    core.info(`Setting field ${statusFieldId} in issue ${projectIssueId} to value ${statusOptionId}`)
    const updateIssueInput: UpdateProjectV2ItemFieldValueInput = {
      fieldId: statusFieldId,
      itemId: projectIssueId,
      projectId: projectId,
      value: {
        singleSelectOptionId: statusOptionId
      }
    }
    await graphqlWithAuth<{
      input: UpdateProjectV2ItemFieldValueInput
    }>(
      `
        mutation($input: UpdateProjectV2ItemFieldValueInput!) {
          updateProjectV2ItemFieldValue(input: $input) { 
            clientMutationId
          }
        }
      `,
      {
        input: updateIssueInput
      }
    )
    core.info('Successfully updated issue status')
  } else {
    core.error(`Error finding project or issue information`)
  }
}

async function fetchProjectInformation(
  graphqlWithAuth: GraphQl,
  projectNumber: number,
): Promise<Maybe<ProjectV2> | undefined> {
  core.info(`Fetching project information for project ${projectNumber}...`)
  const query = await graphqlWithAuth<{
    organization: Organization
  }>(
    `
      query getProjectInformation($org: String!, $projectNum: Int!) {
        organization(login: $org) {
          projectV2(number: $projectNum) {
            id
            fields(first:20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `,
    {
      org: github.context.repo.owner,
      projectNum: projectNumber,
    }
  )

  return query.organization.projectV2;
}

async function fetchIssuesInProject(
  graphqlWithAuth: GraphQl,
  projectNumber: number,
) {
  core.info(`Fetching issues in project ${projectNumber}...`)

  let issues: Maybe<ProjectV2Item>[] = [];

  let cursor = "";
  let hasNextPage = true;

  while (hasNextPage) {
    const query = await graphqlWithAuth<{
      organization: Organization
    }>(
      `
          query getIssues($org: String!, $projectNum: Int!, $endCursor: String!) {
            organization(login: $org) {
              projectV2(number: $projectNum) {
                items(first: 100, after: $endCursor) {
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                  nodes {
                    id
                    content {
                      ... on Issue {
                        number
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      {
        org: github.context.repo.owner,
        projectNum: projectNumber,
        endCursor: cursor
      }
    );

    core.info(`Fetched page with ${query.organization?.projectV2?.items?.nodes?.length} issues`);
    issues = [...issues, ...query.organization?.projectV2?.items?.nodes!];

    const pageInfo = query.organization?.projectV2?.items?.pageInfo!;
    cursor = pageInfo.endCursor!;
    hasNextPage = pageInfo.hasNextPage!;
  }

  core.info(`Fetched ${issues.length} total issues`);
  return issues;
}