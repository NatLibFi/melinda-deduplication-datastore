set @record_timestamp_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='record' AND index_name='record_timestamp');
set @sqlStatement := if( @record_timestamp_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index record_timestamp ON record (recordTimestamp);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;