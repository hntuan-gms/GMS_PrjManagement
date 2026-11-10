-- The dates a plan is laid out on (ai/planner.ts layoutSchedule).
--
-- start_date: day 1 of the plan, fixed when it is generated. Reads used to lay the
-- plan out from "today (UTC)" on every open, so a plan opened the next day moved,
-- and its dates no longer matched what the assistant had said in the chat.
--
-- not_before: the earliest day one item may start, when the brief fixes it
-- ("bảo trì từ ngày 20 mỗi tháng"). Without it, independent items all started on
-- day 1: five monthly maintenance windows were shown on the same day while the
-- assistant described them month by month (MEIKOS26, 2026-11-10).
ALTER TABLE ai_plan_run ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE ai_plan_item ADD COLUMN IF NOT EXISTS not_before date;
