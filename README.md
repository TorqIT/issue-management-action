## Issue Management Action

Automatically assigns and sets the status of GitHub Issues that are linked to Pull Requests.

### Requirements

In order to work with the Projects V2 API, your repository will need to be registered as a client in the GitHub App. Navigate to https://github.com/organizations/TorqIT/settings/apps/issue-management-action, scroll down to "Private keys" and click "Generate a private key". A `.pem` file will be downloaded. Copy the contents of the file and add the following secrets to your GitHub organization or repository:
- `ISSUE_MANAGEMENT_ACTION_APP_ID` = `<App ID value from page linked above>`
- `ISSUE_MANAGEMENT_ACTION_PRIVATE_KEY` = `<Contents of pem file generated above>`

### Example usage

In your workflow, use the Action like the example below. When a review is requested on a Pull Request, the Action will automatically assign any linked issues to the reviewer, and update its status to "Review" (note that a status containing this word must be present in your project). Whenever changes are requested on the PR, the Action will assign the issue back to the original developer, and update its status to "In Progress" (again, a status containing these words must exist in your project).

```yaml
on:
  pull_request:
    types: review_requested
  pull_request_review:
    types: submitted
jobs:
  issue-management:
    runs-on: ubuntu-latest
    steps:
      # Use this Action to generate a token using the GitHub App described above
      - name: Generate token
        id: generate_token
        uses: tibdex/github-app-token@v1
        with:
          app_id: ${{ secrets.ISSUE_MANAGEMENT_ACTION_APP_ID }}
          private_key: ${{ secrets.ISSUE_MANAGEMENT_ACTION_PRIVATE_KEY }}

      - name: Issue management
        uses: TorqIT/issue-management-action@v2
        with:
          token: ${{ steps.generate_token.outputs.token }}
          # Project number. Can be found in the URL of your project (i.e. https://github.com/orgs/<your-org>/projects/<project-number>)
          projectNumber: 10
```

### Development

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. After making your changes, run `npm ci && npm run build && npm run package` to compile and package the changes. Be sure to include these changes in your commit(s).
