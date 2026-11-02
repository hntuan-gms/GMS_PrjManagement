-- The first copies stored each issue exactly as Jira returned it, which included the
-- assignee's email address and timezone (privacy.html §2: no email is stored anywhere).
-- issueCache.slimIssue now strips those before a row is written; these copies predate it.
-- Emptying the cache loses nothing: Jira holds the originals and the next load refills it.
TRUNCATE jira_issue_cache, jira_project_sync, jira_issue_visibility;
