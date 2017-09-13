
alter table candidatesByAuthor MODIFY term VARCHAR(1000);
alter table candidatesByTitle MODIFY term VARCHAR(1000);

set @term_author_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByAuthor' AND index_name='terms');
set @sqlStatement := if( @term_author_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index terms2 ON candidatesByAuthor (term);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;

set @term_title_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByTitle' AND index_name='terms');
set @sqlStatement := if( @term_title_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index terms2 ON candidatesByTitle (term);');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;
