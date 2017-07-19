// @flow
import type { DataStoreService } from './datastore-service.flow';
const promisify = require('es6-promisify');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');
const jsdiff = require('diff');

const logger = require('melinda-deduplication-common/utils/logger');
const utils = require('melinda-deduplication-common/utils/utils');
const initialDatabaseSchema = require('./schema/datastore-schema');

const migrations = '???';
const schemaVersion = 1;

function createDataStoreService(connection: any): DataStoreService {
  const query = promisify(connection.query, connection);

  async function updateSchema() {

    try {

      const dbVersionRow = await query('select version from meta').then(_.head);
      const dbVersion = dbVersionRow.version;
      logger.log('info', `Database version ${dbVersion}`);
      logger.log('info', `Schema version ${schemaVersion}`);
      if (schemaVersion !== dbVersion) {
        logger.log('info', `Updating database version from ${dbVersion} to ${schemaVersion}`);
        throw new Error('Database migration for versions not implemented');
        // migrate!
        // check if schema update required
        // run migration
      }
    } catch(error) {
      const databaseNotInitialized = error.code === 'ER_NO_SUCH_TABLE';
      if (databaseNotInitialized) {
        logger.log('info', 'Database has not been initialized');
        logger.log('info', 'Initializing database');
        await utils.sequence(initialDatabaseSchema.map(sqlString => () => query(sqlString)));
        logger.log('info', 'Database initialized');
        return;
      }
      throw error;
    }
  }

  async function loadRecord(base, recordId) {

    const results = await query('SELECT record from record where base=? and id=?', [base, recordId]);
    const recordString = _.get(results, '[0].record');
    if (recordString === undefined) {
      throw NotFoundError();
    }
    const record = MarcRecord.fromString(recordString);
    return record;    
  }

  async function loadRecordMeta(base, recordId) {
    const results = await query('SELECT * from record where base=? and id=?', [base, recordId]);
    const meta = _.get(results, '[0]');
    if (meta === undefined) {
      throw NotFoundError();
    }
    return _.omit(meta, 'record');
  }
 
  async function saveRecord(base, recordId, record) {
    logger.log('info', `Saving ${base}/${recordId} to database`);

    const now = Date.now();
    try {
      const currentRecord = await loadRecord(base, recordId);
      const currentRecordMeta = await loadRecordMeta(base, recordId);

      const delta = jsdiff.diffLines(currentRecord.toString(), record.toString());

      const deltaRow = {
        id: recordId,
        base: base,
        delta: JSON.stringify(delta),
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
      groupingKeyA: createGroupingKeyA(record),
      groupingKeyB: createGroupingKeyB(record),
      record: record.toString(),
      parentId: parseParentId(record),
      timestamp: now
    };
    
    await query(`
      insert into record (id, base, groupingKeyA, groupingKeyB, record, parentId, timestamp) 
        values (?,?,?,?,?,?,?) 
      ON DUPLICATE KEY UPDATE 
        groupingKeyA=values(groupingKeyA), 
        groupingKeyB=values(groupingKeyB), 
        record=values(record), 
        parentId=values(parentId), 
        timestamp=values(timestamp)`, 
      [
        row.id, 
        row.base, 
        row.groupingKeyA, 
        row.groupingKeyB, 
        row.record, 
        row.parentId, 
        row.timestamp
      ]);
    
  }
  
  return {
    updateSchema,
    loadRecord,
    saveRecord,
  };

}

function createGroupingKeyA(record) {
  return '';
}
function createGroupingKeyB(record) {
  return '';
}
function parseParentId(record) {
  return '';
}

function NotFoundError() {
  const notFoundError = new Error();
  notFoundError.name = 'NOT_FOUND';
  throw notFoundError;
}

module.exports = createDataStoreService;

