-- "What would you improve?" (EPIC 41 P-08): optional free text from the after-game survey.
-- Stored like the rest of the survey: no player id, nickname or room code.
ALTER TABLE session_feedback ADD COLUMN comment TEXT;
