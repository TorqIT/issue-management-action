import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/rest'
import {OctokitResponse} from '@octokit/types'
import {components} from '@octokit/openapi-types'

type Issue = components['schemas']['issue']
type Card = components['schemas']['project-card']

async function run(): Promise<void> {
  const octokit = new Octokit({
    auth: core.getInput('token')
  })

  let reviewers = await fetchRequestedReviewers(octokit)
  if (!reviewers) {
    return
  }

  let issues = await extractIssuesFromPullRequestBody(
    github.context.payload.pull_request?.body
  )

  for (var issue of issues) {
    // Unassign the issue from the PR creator, if possible
    console.log(
      'Unassigning ' + github.context.actor + ' from #' + issue.number
    )
    await octokit.rest.issues.removeAssignees({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issue.number,
      assignees: [github.context.actor]
    })

    await assignIssueToReviewer(octokit, issue)

    await moveIssueFromColumnToColumn(
      octokit,
      issue,
      core.getInput('fromColumnId'),
      core.getInput('toColumnId')
    )
  }

  async function moveIssueFromColumnToColumn(
    octokit: Octokit,
    issue: Issue,
    fromColumnId: string,
    toColumnId: string
  ) {
    console.log('Moving issue #' + issue.number + ' to Review column')
    // Unfortunately the only sane way to interact with an issue on a project board is to find its associated "card"
    let card = await fetchCardForIssue(octokit, issue, fromColumnId)
    if (card) {
      await octokit.rest.projects.moveCard({
        card_id: card.id,
        position: 'bottom',
        column_id: parseInt(toColumnId)
      })
      console.log('Successfully moved issue #' + issue.number)
    }
  }

  async function fetchCardForIssue(
    octokit: Octokit,
    issue: Issue,
    columnId: string
  ): Promise<Card | null> {
    const cards = await octokit.rest.projects.listCards({
      column_id: parseInt(columnId)
    })
    let card = cards.data.find(c => c.content_url === issue.url)
    if (card) {
      console.log('Found card ' + card.id + ' for issue ' + issue.number)
      return card
    } else {
      console.log(
        'No matching card found for issue ' +
          issue.number +
          ' in column ' +
          columnId
      )
      return null
    }
  }

  async function assignIssueToReviewer(octokit: Octokit, issue: Issue) {
    console.log('Assigning ' + reviewers + ' to issue #' + issue.number)
    await octokit.rest.issues.addAssignees({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issue.number,
      assignees: reviewers
    })
    console.log('Successfully assigned issue #' + issue.number)
  }

  async function extractIssuesFromPullRequestBody(
    pullRequestBody?: string
  ): Promise<Issue[]> {
    // Currently, the sanest way to get linked issues is to look for them in the pull request body
    console.log('Pull request body: ' + pullRequestBody)
    let issueNumbers = pullRequestBody?.match(/#\d+/g)
    if (issueNumbers) {
      console.log(
        'Found ' +
          issueNumbers.length +
          ' issue numbers in pull request body: ' +
          issueNumbers
      )
    } else {
      console.log('No linked issues found in pull request body')
      return []
    }

    let issues = []
    for (var issueNumber in issueNumbers) {
      // Parse the actual number (without the #)
      let parsed = issueNumber.match(/\d+/g)
      if (parsed) {
        let issue: Issue | null = await fetchIssue(parsed[0])
        if (issue) {
          issues.push(issue)
        }
      }
    }
    return issues
  }

  async function fetchIssue(issueNumber: string): Promise<Issue | null> {
    try {
      console.log('Fetching issue #' + issueNumber)
      let issue = await github
        .getOctokit(github.context.repo.repo)
        .rest.issues.get({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: parseInt(issueNumber)
        })
      console.log('Found valid issue #' + issueNumber)
      return issue.data
    } catch {
      console.log('No valid issue found for #' + issueNumber)
      return null
    }
  }

  async function fetchRequestedReviewers(octokit: Octokit): Promise<string[]> {
    console.log('Fetching requested reviewers')
    const requestedReviewersJson =
      await octokit.rest.pulls.listRequestedReviewers({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: github.context.issue.number
      })
    const reviewers = requestedReviewersJson.data.users.map(r => r.login)
    if (reviewers) {
      console.log('Pull request reviewers: ' + reviewers)
      return reviewers
    } else {
      console.log('No reviewers found')
      return []
    }
  }
}

run()
