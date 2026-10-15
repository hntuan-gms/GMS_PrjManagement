-- Files attached to a chat message (images, PDFs, text).
--
-- Only the metadata is stored — [{ "name", "mimeType", "size" }] — never the bytes:
-- they are sent to the model for that one turn and dropped (ai/attachments.ts).
-- It is what lets the transcript say "đính kèm: lỗi.png", and what the server checks
-- before regenerating or editing a turn, which it refuses when the file it was
-- answered from no longer exists.
ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS attachments jsonb;
