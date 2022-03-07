## Issue Management Action

Automatically assigns and moves GitHub Issues that are linked to Pull Requests. Created from https://github.com/actions/typescript-action.

### Example usage

In your workflow, use the Action like so. When a review is requested on a Pull Request, the Action will automatically assign any linked issues to the reviewer, and will move those issues from the column defined by `fromColumnIds` to `toColumnId` (e.g. from an "In Progress" column to a "Review" column on your project board). Column IDs can be found by clicking the 3 dots on a column and clicking "Copy column link".

```yaml
on:
  pull_request:
    types: review_requested
jobs:
  steps:
    - name: Issue management
      uses: TorqIT/issue-management@v1.0.0
      with:
        # Token required for access to the project
        token: ${{ secrets.GITHUB_TOKEN }}
        # Comma-separated list of column IDs in which to look for issues
        fromColumnIds: 17949893,17949897
        # Column to move issues to
        toColumnId: 17949897
```

### Development

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. After making your changes, run `npm run build && npm run package` to compile and package the changes. Be sure to push these changes in your commit(s).
