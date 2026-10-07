-- The one or two column choice is gone: wide screens always use two columns.
DELETE FROM settings WHERE name = 'layout';
