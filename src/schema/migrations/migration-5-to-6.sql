SELECT count(*) INTO @exist FROM information_schema.columns WHERE table_schema = database() and COLUMN_NAME = 'recordTimestamp' AND table_name = 'record';
set @query = IF(@exist <= 0, 'alter table record add COLUMN IF NOT EXISTS recordTimestamp DATETIME NOT NULL DEFAULT \'0000-01-01 00:00:00\'', 'select \'Column Exists\' status');
prepare statement from @query;
EXECUTE statement;

set @record_timestamp_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='record' AND index_name='record_timestamp');
set @sqlStatement := if( @record_timestamp_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index record_timestamp ON record (recordTimestamp);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;



