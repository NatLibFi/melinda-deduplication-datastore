set @by_author_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByAuthor' AND index_name='base_id');
set @sqlStatement := if( @by_author_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index base_id ON candidatesByAuthor (base, id);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;

set @by_title_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByTitle' AND index_name='base_id');
set @sqlStatement := if( @by_title_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index base_id ON candidatesByTitle (base, id);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;

set @delta_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='delta' AND index_name='base_id');
set @sqlStatement := if( @delta_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index base_id ON delta (base, id);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;

alter table record DROP COLUMN groupingKeyA;
alter table record DROP COLUMN groupingKeyB;
