
const metaTable = `
create table meta (version int) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;
const addVersion = `
insert into meta values (1);
`;

const recordTable = `
create table if not exists record (
  id varchar(60) NOT NULL PRIMARY KEY,
  base varchar(20) NOT NULL PRIMARY KEY,
  groupingKeyA varchar(255),
  groupingKeyB varchar(255), 
  record text,
  parentId varchar(60),
  timestamp BIGINT NOT NULL,
  PRIMARY KEY (id, base)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

const deltaTable = `
create table if not exists delta (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  delta text,
  timestamp BIGINT NOT NULL,
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

module.exports = [metaTable, addVersion, recordTable, deltaTable];
