
delete indexTable from candidatesByAuthor as indexTable INNER JOIN record on (record.id=indexTable.id) where parentId is not NULL and parentId != '';
delete indexTable from candidatesByTitle as indexTable INNER JOIN record on (record.id=indexTable.id) where parentId is not NULL and parentId != '';
