-- No-op: table "CheckCapture" is already created in 20260427112000_add_check_capture.
-- This migration previously duplicated CREATE TABLE and failed after the earlier migration ran.
-- Safe on empty DBs and on DBs where CheckCapture already exists.
SELECT 1;
