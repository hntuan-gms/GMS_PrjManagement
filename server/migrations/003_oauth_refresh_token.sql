-- Moves the Atlassian refresh token out of the session cookie and into Postgres.
--
-- The sealed gms_sess cookie has to fit in ~3900 bytes, and a refresh token is
-- not fixed-size: an account that belongs to several Atlassian organizations
-- (a consultant, a guest on a partner site) gets a noticeably larger one, and
-- carrying it alongside cloudId/siteUrl/siteName/displayName/avatarUrl in the
-- same cookie pushed some real accounts over the limit — login failed outright
-- with SessionTooLargeError, not a cosmetic issue. Everything else about a
-- session is small and fixed-size regardless of account, so only this one
-- unbounded field needed to move.
--
-- Sealed with the same AES-256-GCM scheme as every cookie (see auth/crypto.ts),
-- under its own AAD purpose, so a Postgres dump doesn't hand out live Jira
-- refresh tokens in plaintext.
CREATE TABLE IF NOT EXISTS oauth_refresh_token (
  cloud_id      text        NOT NULL,
  account_id    text        NOT NULL,
  refresh_token text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, account_id)
);
