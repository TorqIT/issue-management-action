import * as core from '@actions/core'
import * as github from '@actions/github'
import { components } from '@octokit/openapi-types'
import { graphql } from '@octokit/graphql'
import type { graphql as GraphQl } from '@octokit/graphql/dist-types/types'
import { Octokit } from '@octokit/rest'
import {
    Organization,
    ProjectV2SingleSelectField,
    UpdateProjectV2ItemFieldValueInput,
    Issue as GraphQlIssue,
    Maybe,
    ProjectV2,
    ProjectV2Item
} from '@octokit/graphql-schema'

type Issue = components['schemas']['issue']

enum Operation {
    ReviewRequested = 'review_requested',
    ChangesRequested = 'changes_requested'
}

async function run(): Promise<void> {
    const octokit = new Octokit({
        auth: core.getInput('token')
    })

    const graphqlWithAuth = graphql.defaults({
        headers: {
            authorization: `token ${core.getInput('token')}`
        }
    })

    const reviewers = await fetchRequestedReviewers(octokit)

    const issues = await extractIssuesFromPullRequestBody(
        octokit,
        github.context.payload.pull_request?.body
    )

    for (const issue of issues) {
        let toBeAssigned;
        let toBeUnassigned;
        if (core.getInput('operation') === Operation.ReviewRequested) {
            toBeAssigned = reviewers;
            toBeUnassigned = [github.context.actor];
        } else if (core.getInput('operation') === Operation.ChangesRequested) {
            toBeAssigned = [github.context.actor];
            toBeUnassigned = reviewers;
        }

        core.info(`Unassigning ${toBeUnassigned} from #${issue.number}`)
        await octokit.rest.issues.removeAssignees({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            assignees: toBeUnassigned
        })

        core.info(`Assigning issue #${issue.number} to ${toBeAssigned}`)
        await octokit.rest.issues.addAssignees({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            assignees: toBeAssigned
        })

        await updateIssueStatusInProject(
            graphqlWithAuth,
            issue,
            Number(core.getInput('projectNumber')),
            core.getInput('operation')
        )
    }
}

async function fetchRequestedReviewers(octokit: Octokit): Promise<string[]> {
    core.info(`Fetching requested reviewers`)
    const requestedReviewersJson =
        await octokit.rest.pulls.listRequestedReviewers({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: github.context.issue.number
        })
    const reviewers = requestedReviewersJson.data.users.map(r => r.login)
    if (reviewers) {
        core.info(`Pull request reviewers: ${reviewers}`)
        return reviewers
    } else {
        core.info(`No reviewers found`)
        return []
    }
}

async function extractIssuesFromPullRequestBody(
    octokit: Octokit,
    pullRequestBody?: string
): Promise<Issue[]> {
    // Currently, the sanest way to get linked issues is to look for them in the pull request body
    core.info(`Pull request body: ${pullRequestBody}`)
    const issueNumbers = pullRequestBody?.match(/#\d+/g)
    if (issueNumbers) {
        core.info(
            `Found ${issueNumbers.length} issue numbers in pull request body: ${issueNumbers}`
        )
    } else {
        core.info(`No linked issues found in pull request body`)
        return []
    }

    const issues = []
    for (const issueNumber of issueNumbers) {
        core.info(`Issue number: ${issueNumber}`)
        // Parse the actual number (without the #)
        const parsed = issueNumber.replace(/[^0-9]/g, '')
        if (parsed) {
            const issue = await fetchIssue(octokit, parsed)
            if (issue) {
                issues.push(issue)
            }
        }
    }
    return issues
}

async function fetchIssue(
    octokit: Octokit,
    issueNumber: string
): Promise<Issue | null> {
    try {
        core.info(`Fetching issue #${issueNumber}`)
        const issue = await octokit.rest.issues.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: parseInt(issueNumber)
        })
        core.info(`Found valid issue #${issueNumber}`)
        return issue.data
    } catch (e) {
        if (e instanceof Error) core.error(e.message)
        core.info(`No valid issue found for #${issueNumber}`)
        return null
    }
}

async function updateIssueStatusInProject(
    graphqlWithAuth: GraphQl,
    issue: Issue,
    projectNumber: number,
    operation: string
): Promise<void> {
    core.info(`Updating status for issue #${issue.number}...`)

    const project = await fetchProjectInformation(graphqlWithAuth, projectNumber);

    const projectId = project?.id

    const statusField = project?.fields.nodes?.find(
        x => x?.name === 'Status'
    ) as ProjectV2SingleSelectField
    const statusFieldId = statusField?.id

    const statusSearchString = operation === Operation.ReviewRequested ? 'Review' : 'In Progress'
    const statusOptionId = statusField?.options.find(x =>
        x.name.includes(statusSearchString)
    )?.id

    const issues = await fetchIssuesInProject(graphqlWithAuth, projectNumber);
    const projectIssueId = issues.find(
        x => (x?.content as GraphQlIssue).number
    )?.id
    core.info(`Found project issue with ID ${projectIssueId} for issue #${issue.number}`);

    if (statusFieldId && statusOptionId && projectId && projectIssueId) {
        core.info(`Setting field ${statusFieldId} in issue ${issue.id}`)
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

run()
