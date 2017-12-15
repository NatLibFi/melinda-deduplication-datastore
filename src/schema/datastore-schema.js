/**
 *
 * @licstart  The following is the entire license notice for the JavaScript code in this file. 
 *
 * Datastore microservice of Melinda deduplication system
 *
 * Copyright (c) 2017 University Of Helsinki (The National Library Of Finland)
 *
 * This file is part of melinda-deduplication-datastore
 *
 * melinda-deduplication-datastore is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *  
 * melinda-deduplication-datastore is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *  
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @licend  The above is the entire license notice
 * for the JavaScript code in this file.
 *
 **/
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
  timestamp BIGINT NOT NULL,
  PRIMARY KEY (id, base)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

const deltaTable = `
create table if not exists delta (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  delta text,
  timestamp BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

const candidatesNeighbourhoodByAuthor = `
create table if not exists candidatesByAuthor (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  term text
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

const candidatesNeighbourhoodByTitle = `
create table if not exists candidatesByTitle (
  id varchar(60) NOT NULL,
  base varchar(20) NOT NULL,
  term text
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`;

module.exports = [metaTable, addVersion, recordTable, deltaTable, candidatesNeighbourhoodByAuthor, candidatesNeighbourhoodByTitle];
