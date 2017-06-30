
const metaTable = `
create table meta (version int) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;
const addVersion = `
insert into meta values (1);
`;

const recordTable = `
create table if not exists record (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  groupingKeyA varchar(255),
  groupingKeyB varchar(255), 
  record text,
  parentId varchar(60),
  timestamp timestamp
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

const deltaTable = `
create table if not exists delta (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  patch text,
  timestamp timestamp
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

module.exports = [metaTable, addVersion, recordTable, deltaTable];
