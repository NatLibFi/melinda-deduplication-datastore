
set @term_author_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByAuthor' AND index_name='terms');
set @sqlStatement := if( @term_author_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index terms ON candidatesByAuthor (term(250));');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;

set @term_title_index_exists = (SELECT COUNT(1) IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema=DATABASE() AND table_name='candidatesByTitle' AND index_name='terms');
set @sqlStatement := if( @term_title_index_exists > 0, 'select ''INFO: Index already exists.''', 'create index terms ON candidatesByTitle (term(250));');
PREPARE statement FROM @sqlStatement;
EXECUTE statement;
