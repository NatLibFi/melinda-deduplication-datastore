// @flow
import type { DataStoreService } from './datastore-service.flow';

const promisify = require('es6-promisify');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');
const DiffMatchPatch = require('diff-match-patch');
const moment = require('moment');
const generateUUID = require('uuid/v1');

const logger = require('melinda-deduplication-common/utils/logger');
const RecordUtils = require('melinda-deduplication-common/utils/record-utils');
const initialDatabaseSchema = require('./schema/datastore-schema');
const createCandidateService = require('./candidate-service');

const getMigrationCommands = require('./schema/migrations');
const SCHEMA_VERSION = 6;

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
    let statement = `select temp.id, record.recordTimestamp, record.parentId, record.timestamp ${metadataOnly ? '' : ', record'} from ${tableName} temp, record where temp.id = record.id`;    
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
    const results = await query(generateRecordsTempTableQuery(tempTable, { limit, offset, metadataOnly }));
    if (results.length < limit) {
      await dropTempTable(tempTable);
    } else {
      await updateTempTableAccessTime(tempTable);
    }
    return {
      totalLength: numberOfRows,
      offset: offset,   
      results: formatRecordsQueryResults(results, includeMetadata, metadataOnly)
    };
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
        return formatRecordsQueryResults(results, includeMetadata, metadataOnly);
      }            
    } else {
      const { statement, args } = queryCallback('SELECT * from record where base=?');
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
      return includeMetadata ? Object.assign(resultObject, { record : record }) : record;
    }   
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
    
    const patches = deltaRows.map(row => _.get(row, 'delta')).map(deltaString => JSON.parse(deltaString));
    const historicRecordString = patches.reduce((record, patch) => {
      const [patchedRecord,] = dmp.patch_apply(patch, record);
      return patchedRecord;
    }, current);
    
    const record = MarcRecord.fromString(historicRecordString);
    return record;
  }
  
  async function loadRecordHistory(base, recordId) {
    
    const history = await query('SELECT timestamp, id, base from delta where base=? and id=? ORDER BY timestamp DESC', [base, recordId]);
    
    const current = await query('SELECT timestamp, id, base from record where base=? and id=?', [base, recordId]);
    
    const all = _.concat(current, history);
    
    if (all.length === 0) {
      throw NotFoundError();
    }
    
    return all;
    
  }
  
  async function saveRecord(base, recordId, record, quiet=false) {
    
    if (!quiet) logger.log('info', `Saving ${base}/${recordId} to database`);
    
    const now = Date.now();
    try {
      const currentRecordData = await loadRecord(base, recordId, true);
      const currentRecord = currentRecordData.record;
      const currentRecordMeta = _.omit(currentRecordData, 'record');
      
      const currentRecordLastModificationDate = RecordUtils.getLastModificationDate(currentRecord);
      const incomingRecordLastModificationDate = RecordUtils.getLastModificationDate(record);
      
      if (currentRecordLastModificationDate > incomingRecordLastModificationDate) {
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
        timestamp: currentRecordMeta.timestamp
      };
      
      await query('insert into delta set ?', deltaRow);
      
    } catch(error) {
      if (error.name !== 'NOT_FOUND') {
        throw error;
      }
    }
    
    const row = {
      id: recordId,
      base: base,
      record: record.toString(),
      parentId: RecordUtils.parseParentId(record),
      timestamp: now,
      recordTimestamp: moment(RecordUtils.getLastModificationDate(record)).format(RECORD_TIMESTAMP_FORMAT)
    };
    
    await query(`
      insert into record (id, base, record, parentId, timestamp, recordTimestamp)
      values (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE 
      record=values(record), 
      parentId=values(parentId), 
      timestamp=values(timestamp),
      recordTimestamp=values(recordTimestamp)`,
      [
        row.id, 
        row.base, 
        row.record, 
        row.parentId, 
        row.timestamp,
        row.recordTimestamp
      ]);
      
    if (!quiet) logger.log('info', `Record ${base}/${recordId} saved succesfully.`);
      
    await candidateService.update(base, recordId, record, quiet);
      
  }
    
  return {
    rebuildCandidateTerms,
    updateSchema,
    dropTempTables,
    createTempTablesMeta,
    getEarliestRecordTimestamp,
    getLatestRecordTimestamp,
    loadRecords,
    loadRecordsResume,
    loadRecord,
    loadRecordByTimestamp,
    saveRecord,
    loadRecordHistory,
    loadCandidates: candidateService.loadCandidates
  };
  
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
  
