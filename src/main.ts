import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/rest'
import {components} from '@octokit/openapi-types'

type Issue = components['schemas']['issue']
type Card = components['schemas']['project-card']

async function run(): Promise<void> {
  const octokit = new Octokit({
    auth: core.getInput('token')
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

    await moveIssueFromColumnToColumn(
      octokit,
      issue,
      core.getInput('fromColumnIds'),
      core.getInput('toColumnId')
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

async function moveIssueFromColumnToColumn(
  octokit: Octokit,
  issue: Issue,
  fromColumnIds: string,
  toColumnId: string
): Promise<void> {
  core.info(`Moving issue #${issue.number} to column ${toColumnId}`)
  // Unfortunately the only sane way to interact with an issue on a project board is to find its associated "card"
  const card = await fetchCardForIssue(octokit, issue, fromColumnIds)
  if (card) {
    await octokit.rest.projects.moveCard({
      card_id: card.id,
      position: 'bottom',
      column_id: parseInt(toColumnId)
    })
    core.info(`Successfully moved issue #${issue.number}`)
  }
}

async function fetchCardForIssue(
  octokit: Octokit,
  issue: Issue,
  columnIds: string
): Promise<Card | null> {
  let card = null
  for (const columnId of columnIds.split(',')) {
    core.info(`Searching for matching cards in column ${columnId}`)
    const response = await octokit.rest.projects.listCards({
      column_id: parseInt(columnId)
    })
    card = response.data.find(c => c.content_url === issue.url)
    if (card) {
      core.info(`Found card ${card.id} for issue ${issue.number}`)
      return card
    }
  }

  core.info(
    `No matching card found for issue ${issue.number} in columns ${columnIds}`
  )
  return null
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
