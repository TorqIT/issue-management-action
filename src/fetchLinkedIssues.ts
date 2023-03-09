import * as core from '@actions/core'
import * as github from '@actions/github'
import { Octokit } from '@octokit/rest'
import { components } from '@octokit/openapi-types'

export type Issue = components['schemas']['issue']

/**
 * Fetches issues linked to the given pull request.
 */
export async function fetchLinkedIssues(
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