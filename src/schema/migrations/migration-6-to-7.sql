CREATE TABLE IF NOT EXISTS lowTags (id varchar(5) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8;

SELECT count(*) INTO @exist FROM information_schema.columns WHERE table_schema = database() and COLUMN_NAME = 'lowTags' AND table_name = 'record';
set @query = IF(@exist <= 0, 'alter table record add COLUMN lowTags VARCHAR(600)', 'select \'Column Exists\' status;');
prepare statement from @query;
EXECUTE statement;

set @record_low_tags_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='record' AND index_name='record_low_tags');
set @sqlStatement := if( @record_low_tags_index_exists > 0, 'select ''INFO: Index already exists.''', 'create fulltext index record_low_tags ON record (lowTags);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;