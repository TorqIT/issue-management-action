import * as core from '@actions/core'
import * as github from '@actions/github'
import { components } from '@octokit/openapi-types'
import { graphql } from '@octokit/graphql'
import type { graphql as GraphQl } from '@octokit/graphql/dist-types/types'
import { Octokit } from '@octokit/rest'
import {
    Organization,
    ProjectV2Field,
    ProjectV2SingleSelectField,
    Repository,
    UpdateProjectV2ItemFieldValueInput,
    Issue as GraphQlIssue
} from '@octokit/graphql-schema'

type Issue = components['schemas']['issue']

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
        // Unassign the issue from the PR creator, if possible
        core.info(`Unassigning ${github.context.actor} from #${issue.number}`)
        await octokit.rest.issues.removeAssignees({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            assignees: [github.context.actor]
        })

        await assignIssueToReviewer(octokit, issue, reviewers)

        await updateIssueStatusInProject(
            graphqlWithAuth,
            issue,
            Number(core.getInput('projectNumber'))
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
    projectNumber: number
): Promise<void> {
    core.info(`Updating status for issue #${issue.number}...`)

    const project = await fetchProjectInformation(graphqlWithAuth, projectNumber);

    core.info(`Issue node ID: ${issue.node_id}`);
    const projectV2IssueId = project.organization.projectV2?.items.nodes?.find(
        x => (x?.content as GraphQlIssue).number
    )

    const projectId = project?.organization?.projectV2?.id
    const statusField = project?.organization?.projectV2?.fields.nodes?.find(
        x => x?.name === 'Status'
    ) as ProjectV2SingleSelectField
    const statusFieldId = statusField?.id
    const reviewOptionId = statusField?.options.find(x =>
        x.name.includes('Review')
    )?.id

    if (statusFieldId && reviewOptionId && projectId) {
        core.info(`Setting field ${statusFieldId} in issue ${issue.id}`)
        const updateIssueInput: UpdateProjectV2ItemFieldValueInput = {
            fieldId: statusFieldId,
            itemId: issue.node_id,
            projectId: projectId,
            value: {
                singleSelectOptionId: reviewOptionId
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
        core.error(`Error finding project information`)
    }
}

async function fetchProjectInformation(
    graphqlWithAuth: GraphQl,
    projectNumber: number,
): Promise<{ organization: Organization, repository: Repository }> {
    core.info(`Fetching issues in project ${projectNumber}...`)
    const query = await graphqlWithAuth<{
        organization: Organization
        repository: Repository
    }>(
        `
      query GetIssueInformation($org: String!, $projectNum: Int!) {
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
          items(first: 100) {
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
    `,
        {
            org: github.context.repo.owner,
            projectNum: projectNumber,
        }
    )

    return query;
}

async function assignIssueToReviewer(
    octokit: Octokit,
    issue: Issue,
    reviewers: string[]
): Promise<void> {
    core.info(`Assigning reviewers ${reviewers} to issue #${issue.number}`)
    await octokit.rest.issues.addAssignees({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        assignees: reviewers
    })
    core.info(`Successfully assigned issue #${issue.number}`)
}

run()
