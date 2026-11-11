-- Booking: time of a person promised to a project, before (and whether or not) any task exists.
--
-- Not derivable from Jira: an issue's assignee says who holds a task, not that a manager set
-- aside half of a person's December for a project. It is the layer between capacity
-- (resource_profile / resource_absence) and what was actually logged (Jira worklogs).
--
-- hours_per_day, not a percentage: "50%" typed in the UI is converted against the person's
-- capacity when it is entered. A stored percentage would change meaning for every old booking
-- the day that capacity is edited.
--
-- Rows are site-wide (cloud_id), not per project: the whole point is to add one person's
-- bookings up across projects. Who may see which row is decided in booking.ts.
CREATE TABLE IF NOT EXISTS resource_booking (
  id            bigserial     PRIMARY KEY,
  cloud_id      text          NOT NULL,
  account_id    text          NOT NULL,
  project_key   text          NOT NULL,
  from_date     date          NOT NULL,
  to_date       date          NOT NULL,
  hours_per_day numeric(4, 2) NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 16),
  status        text          NOT NULL DEFAULT 'tentative' CHECK (status IN ('tentative', 'confirmed')),
  note          text,
  created_by    text          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT resource_booking_range CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS resource_booking_person_idx
  ON resource_booking (cloud_id, account_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS resource_booking_project_idx
  ON resource_booking (cloud_id, project_key, from_date, to_date);
