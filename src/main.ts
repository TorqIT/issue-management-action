import * as core from '@actions/core'
import * as github from '@actions/github'
import { components } from '@octokit/openapi-types'
import { User, PullRequestReviewSubmittedEvent, PullRequestReviewRequestedEvent } from '@octokit/webhooks-types'
import { Octokit } from '@octokit/rest'
import { fetchLinkedIssues } from './fetchLinkedIssues'
import { updateIssueStatus, Status } from './updateIssueStatus'

type Issue = components['schemas']['issue']

async function run(): Promise<void> {
    const octokit = new Octokit({
        auth: core.getInput('token')
    })

    const testers = core.getInput('testers').split(',');

    const eventInfo = await extractEventInformation(octokit, testers);

    if (eventInfo) {
        for (const issue of eventInfo.linkedIssues) {
            await updateAssignees(octokit, issue, eventInfo.toBeAssigned);
            await updateIssueStatus(
                issue.number,
                Number(core.getInput('projectNumber')),
                eventInfo.statusToBeSet
            )
        }
    }
}

async function updateAssignees(octokit: Octokit, issue: Issue, assignees: string[]) {
    core.info(`Unassigning all current assignees from #${issue.number}`)
    await octokit.rest.issues.removeAssignees({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        assignees: issue.assignees?.map(a => a.login)
    })

    core.info(`Assigning issue #${issue.number} to ${assignees}`)
    await octokit.rest.issues.addAssignees({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        assignees: assignees
    })
}

async function extractEventInformation(octokit: Octokit, testers: string[]): Promise<{
    toBeAssigned: string[],
    linkedIssues: Issue[],
    statusToBeSet: Status
} | undefined> {
    let toBeAssigned: string[] = [];
    let linkedIssues: Issue[] = [];
    let statusToBeSet: Status;
    if (github.context.eventName === 'pull_request'
        && github.context.payload.action === 'review_requested') {
        const event = github.context.payload as PullRequestReviewRequestedEvent;
        core.info(`Review was requested on pull request #${event.pull_request.number} by ${event.sender.login}`);

        linkedIssues = await fetchLinkedIssues(octokit, event.pull_request.body!);

        const reviewers = event.pull_request.requested_reviewers.map(r => (r as User).login);
        core.info(`Requested reviewers: ${reviewers}`);
        toBeAssigned = reviewers;

        const requestedTesters = testers.filter(t => reviewers.includes(t));
        if (requestedTesters.length > 0) {
            core.info(`Requested testers: ${requestedTesters}`);
            statusToBeSet = Status.Test;
        } else {
            statusToBeSet = Status.Review;
        }
    } else if (github.context.eventName === 'pull_request_review') {
        const event = github.context.payload as PullRequestReviewSubmittedEvent;
        if (event.review.state === 'changes_requested') {
            core.info(`Changes were requested on pull request #${event.pull_request.number}`);

            linkedIssues = await fetchLinkedIssues(octokit, event.pull_request.body!);

            toBeAssigned = [event.pull_request.user.login];

            statusToBeSet = Status.InProgress;
        } else {
            core.info("Submitted review had no requested changes, so exiting");
            return;
        }
    }

    return {
        toBeAssigned: toBeAssigned,
        linkedIssues: linkedIssues,
        statusToBeSet: statusToBeSet!
    }
}


run()
