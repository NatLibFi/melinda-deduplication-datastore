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
// @flow
import type { DataStoreService } from './datastore-service.flow';

const promisify = require('es6-promisify');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');
const DiffMatchPatch = require('diff-match-patch');
const moment = require('moment');
const generateUUID = require('uuid/v1');

const logger = require('@natlibfi/melinda-deduplication-common/utils/logger');
const RecordUtils = require('@natlibfi/melinda-deduplication-common/utils/record-utils');
const initialDatabaseSchema = require('./schema/datastore-schema');
const createCandidateService = require('./candidate-service');

const getMigrationCommands = require('./schema/migrations');
const SCHEMA_VERSION = 7;

const RECORD_TIMESTAMP_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SS';

function createDataStoreService(connectionPool: any): DataStoreService {
  const getConnectionFromPool = promisify(connectionPool.getConnection, connectionPool);
    
  const query = async (...args) => {
    const connection = await getConnectionFromPool();
    const querySql = promisify(connection.query, connection);
    const result = await querySql(...args);
    connection.release();
    return result;
  };
    
  const candidateService = createCandidateService(connectionPool);
  const dmp = new DiffMatchPatch();
    
  async function updateSchema() {
      
    try {
        
      const dbVersion = await getDatabaseVersion();
        
      logger.log('info', `Database version ${dbVersion}`);
      logger.log('info', `Schema version ${SCHEMA_VERSION}`);
      if (SCHEMA_VERSION !== dbVersion) {
        logger.log('info', `Updating database version from ${dbVersion} to ${SCHEMA_VERSION}`);
          
        const migrations = getMigrationCommands({from: dbVersion, to: SCHEMA_VERSION});
        for (const migration of migrations) {
          for (const sqlString of migration.migrationSQL) {
            logger.log('info', sqlString);
            await query(sqlString);
          }
            
          await migration.migrationFn(connectionPool, logger);
            
        }
        await query('update meta set version=?', [SCHEMA_VERSION]);
        const dbVersionAfterMigration = await getDatabaseVersion();
          
        logger.log('info', `Database updated from version ${dbVersion} to ${dbVersionAfterMigration}`);
          
      }
    } catch(error) {
      const databaseNotInitialized = error.code === 'ER_NO_SUCH_TABLE';
      if (databaseNotInitialized) {
        logger.log('info', 'Database has not been initialized');
        logger.log('info', 'Initializing database');
          
        for (const sqlString of initialDatabaseSchema) {
          logger.log('info', sqlString);
          await query(sqlString);
        }
          
        logger.log('info', 'Database initialized');
          
        return updateSchema();
      }
      throw error;
    }
  }
    
  async function getDatabaseVersion() {
      
    const dbVersionRow = await query('select version from meta').then(_.head);
    const dbVersion = dbVersionRow.version;
    return dbVersion;
  }
    
  async function rebuildCandidateTerms() {
    return candidateService.rebuild();
  }
    
  async function dropTempTable(name) {
    await query(`DROP TABLE if exists ${name}`);
    await query('DELETE from temp_tables_meta where name = ?', [name]);
    logger.log('info', `Dropped temporary table ${name}`);
  }
    
  async function dropTempTables(lifetime) {
    const timestamp = moment().subtract(lifetime, 'milliseconds').toDate();
    const results = await query('SELECT name from temp_tables_meta where access_time < ?', [timestamp]);
    results.forEach(async result => dropTempTable(result.name));          
  }
    
  async function createTempTablesMeta() {
    const results = await query('SELECT table_name from information_schema.tables where table_name like ?', ['temp%']);
    results.forEach(async result => await query(`DROP TABLE IF EXISTS ${result.table_name}`));
      
    await query('DROP TABLE IF EXISTS temp_tables_meta');
    await query('CREATE TABLE temp_tables_meta (name VARCHAR(100) primary key, access_time DATETIME) ENGINE=MEMORY');
  }
    
  async function updateTempTableAccessTime(tableName) {
    await query('REPLACE into temp_tables_meta (name,access_time) VALUES(?,?)', [tableName, moment().toDate()]);
  }
    
  // $FlowFixMe: Flow doesn't seem to understand destructuring optional object parameter with defaults
  function generateRecordsTempTableQuery(tableName, { limit=undefined, offset=0, metadataOnly=false } = {}) {
    let statement = `select temp.id, record.recordTimestamp, record.parentId, record.timestamp, record.lowTags ${metadataOnly ? '' : ', record'} from ${tableName} temp, record where temp.id = record.id`;    
    if (limit && offset) {
      statement += ` limit ${offset},${limit}`;
    } else if (limit) {
      statement += ` limit ${limit}`;
    } else if (offset) {
      statement += ` limit ${offset},${Number.MAX_SAFE_INTEGER}`;
    }
    return statement;        
  }
    
  function formatRecordsQueryResults(results, includeMetadata, metadataOnly) {
    return results.map(result => {
      if (includeMetadata || metadataOnly) {
        result = transformLowTags(result);
        return metadataOnly ? _.omit(result, 'record') : Object.assign(result, { record : MarcRecord.fromString(result.record) });           
      } else {
        return MarcRecord.fromString(result.record);
      }      
    });
  }
    
  async function getNumberOfTableRows(table) {
    const numberOfRowsResults = await query(`select count(*) from ${table}`);
    return Number(Object.values(numberOfRowsResults.shift()).shift());
  }
    
  async function loadRecordsResume(tempTable, { limit=undefined, offset=0, includeMetadata=false, metadataOnly=false } = {}) {
    const numberOfRows = await getNumberOfTableRows(tempTable);
    const rows = await query(generateRecordsTempTableQuery(tempTable, { limit, offset, metadataOnly }));    
      
    if (rows.length < limit) {
      await dropTempTable(tempTable);
      return {
        offset,
        totalLength: numberOfRows,
        results: formatRecordsQueryResults(rows, includeMetadata, metadataOnly)
      };
    } else {
      await updateTempTableAccessTime(tempTable);
      return {
        tempTable,
        offset,
        totalLength: numberOfRows,
        results: formatRecordsQueryResults(rows, includeMetadata, metadataOnly)
      };
    }
  }
    
  async function loadRecords(base, { queryCallback=q => { return { statement: q, args: [] }; }, limit=undefined, includeMetadata=false, metadataOnly=false } = {}) {            
    if (Number.isInteger(limit)) {
      const { statement, args } = queryCallback('SELECT id from record where base=?');
      const tableName = `temp${generateUUID().replace(/-/g, '')}`;
        
      await query(`CREATE TABLE ${tableName} ENGINE=MEMORY ${statement} ORDER BY recordTimestamp DESC`, [base].concat(args));
      const numberOfRows = await getNumberOfTableRows(tableName);
        
      // $FlowFixMe: See https://github.com/facebook/flow/issues/183
      if (numberOfRows > limit) {
        const results = await query(generateRecordsTempTableQuery(tableName, { limit, metadataOnly }));
        await updateTempTableAccessTime(tableName);
        return {
          tempTable: tableName,
          offset: 0,      
          totalLength: numberOfRows,
          results: formatRecordsQueryResults(results, includeMetadata, metadataOnly)
        };
      } else {        
        const results = await query(generateRecordsTempTableQuery(tableName, { limit, metadataOnly }));
        await dropTempTable(tableName);
        return {          
          results: formatRecordsQueryResults(results, includeMetadata, metadataOnly)
        };
      }            
    } else {
      const { statement, args } = queryCallback(`SELECT id,parentId,timestamp,recordTimestamp,lowTags${metadataOnly ? '' : ',record'} from record where base=?`);      
      const results = await query(`${statement} ORDER BY recordTimestamp DESC`, [base].concat(args));        
      return formatRecordsQueryResults(results, includeMetadata, metadataOnly);
    }     
  }
    
  async function loadRecord(base, recordId, includeMetadata=false) {
    let statement;
      
    if (includeMetadata) {
      statement = 'SELECT * from record where base=? and id=?';        
    } else {
      statement = 'SELECT record from record where base=? and id=?';
    }
      
    const results = await query(statement, [base, recordId]);
    const resultObject = results.shift();
      
    if (resultObject === undefined) {
      throw NotFoundError();
    } else {
      const record = MarcRecord.fromString(resultObject.record);
      return includeMetadata ? Object.assign(transformLowTags(resultObject), { record : record }) : record;
    }   
  }
    
  async function getLowTags() {
    const result = await query('SELECT id from lowTags ORDER BY id ASC', []);
    if (result.length === 0) {
      NotFoundError();
    }
    return result.map(row => row.id);
  }
    
  async function getEarliestRecordTimestamp(base) {
    const result = await query('SELECT recordTimestamp from record ORDER BY recordTimestamp ASC LIMIT 1', [base]);
    return result.shift().recordTimestamp;
  }
    
  async function getLatestRecordTimestamp(base) {
    const result = await query('SELECT recordTimestamp from record ORDER BY recordTimestamp DESC LIMIT 1', [base]);
    return result.shift().recordTimestamp;
  }
    
  async function loadRecordByTimestamp(base, recordId, timestamp) {      
    const deltaRows = await query('SELECT delta from delta where base=? and id=? and timestamp >=? ORDER BY timestamp DESC', [base, recordId, timestamp]);
    const recordRows = await query('SELECT record from record where base=? and id=?', [base, recordId]);
    const current = _.get(recordRows, '[0].record');
    if (current === undefined) {
      throw NotFoundError();
    }
      
    // Ditch the first delta since the changes are already present in the record
    deltaRows.shift();
      
    const patches = deltaRows.map(row => _.get(row, 'delta')).map(deltaString => JSON.parse(deltaString));
    const historicRecordString = patches.reduce((record, patch) => {
      const [patchedRecord,] = dmp.patch_apply(patch, record);
      return patchedRecord;
    }, current);
      
    const record = MarcRecord.fromString(historicRecordString);
    return record;
  }
    
  async function loadRecordHistory(base, recordId) {
    const history = await query('SELECT * from delta where base=? and id=? ORDER BY timestamp DESC', [base, recordId]);      
    if (history.length === 0) {
      throw NotFoundError();
    }      
    return history;
  }
    
  async function loadRecordLastModificationTime(base, recordId) {
    const result = await query('SELECT timestamp from delta where base=? and id=? ORDER BY timestamp DESC LIMIT 1', [base, recordId]);      
    if (result.length === 0) {
      throw NotFoundError();
    }      
    return result.timestamp;
  }
    
  async function saveRecord(base, recordId, record, changeType, changeTimestamp, quiet=false) {      
    if (!quiet) logger.log('info', `Saving ${base}/${recordId} to database`);
    
    try {
      const currentRecord = await loadRecord(base, recordId);
      const currentRecordLastModificationTime = await loadRecordLastModificationTime(base, recordId);
                
      if (currentRecordLastModificationTime > changeTimestamp) {
        throw RecordIsOlderError();
      }
        
      // Diff from incoming record -> current record
      // The incoming record is saved, and diff can be used to construct the previous record
      const diffs = dmp.diff_main(record.toString(), currentRecord.toString());
      const patches = dmp.patch_make(diffs);
        
      const deltaRow = {
        id: recordId,
        base: base,
        delta: JSON.stringify(patches),
        type: changeType,
        timestamp: changeTimestamp
      };
        
      await query('insert into delta set ?', deltaRow);
        
    } catch(error) {
      if (error.name !== 'NOT_FOUND') {
        throw error;
      }
    }
      
    const lowTags = record.get(/^LOW$/)
      .map(e => e.subfields.find(e => e.code === 'a').value)
      .reduce((acc,v) => acc.includes(v) ? acc : acc.concat(v), []);
    const row = {
      id: recordId,
      base: base,
      record: record.toString(),
      parentId: RecordUtils.parseParentId(record),        
      lowTags: lowTags.join(',')
    };
      
    await query(`
        insert into record (id, base, record, parentId, lowTags)
        values (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE 
        record=values(record), 
        parentId=values(parentId),         
        lowTags=values(lowTags)`,
      [
        row.id, 
        row.base, 
        row.record, 
        row.parentId,          
        row.lowTags
      ]);
        
    if (!quiet) logger.log('info', `Record ${base}/${recordId} saved succesfully.`);
        
    await updateLowTags(lowTags, quiet);
    await candidateService.update(base, recordId, record, quiet);
    
    async function updateLowTags(lowTags, quiet) {
      if (!quiet) logger.log('info', 'Update low tags');
      await query(`insert ignore into lowTags (id) values ${lowTags.map(() => '(?)').join(',')}`, lowTags);
    } 
  }
      
  return {
    rebuildCandidateTerms,
    updateSchema,
    dropTempTables,
    createTempTablesMeta,
    getEarliestRecordTimestamp,
    getLatestRecordTimestamp,
    getLowTags,
    loadRecords,
    loadRecordsResume,
    loadRecord,
    loadRecordByTimestamp,
    saveRecord,
    loadRecordHistory,
    loadCandidates: candidateService.loadCandidates
  };
    
    
  function transformLowTags(result) {
    return Object.assign(result, { lowTags: result.lowTags ? result.lowTags.split(',').sort() : [] });
  }
    
  function NotFoundError() {
    const notFoundError = new Error();
    notFoundError.name = 'NOT_FOUND';
    throw notFoundError;
  }
      
  function RecordIsOlderError() {
    const error = new Error();
    error.name = 'RecordIsOlderError';
    throw error;
  }
}
    
module.exports = {
  createDataStoreService,
  RECORD_TIMESTAMP_FORMAT
};
    
