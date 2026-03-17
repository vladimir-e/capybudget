Review the current branch's PR against main

Organize your review into these sections:

## 1. Architecture & Design
Look for opportunities to improve architecture: reducing duplication, consolidating abstractions, making things clearer and simpler. What most reviewers would mark as "nit-pick" or "low priority" is actually high priority here — each time a new agent works on this code it needs to be consistent and clear for agentic coding to succeed. Reference specs/ for architectural context.

## 2. Dead Code & Cleanup
I iterated a lot on this branch. Look for leftovers and dead code from that iteration
- Unused imports, variables, functions, or components
- Commented-out code that should be removed
- Redundant logic or conditions that no longer apply
- Temporary workarounds that can be cleaned up

## 3. Test Coverage
Identify missing tests:
- New functions/components without corresponding test files
- Edge cases in changed logic that aren't covered
- Integration points that should be tested

## 4. Documentation
Check if specs/, README.md, or CHANGELOG.md need updates — but remember we keep docs slim and high-level. Only flag genuinely missing or stale information, not opportunities to add more detail.

Prioritize findings by impact. Group related items together.
