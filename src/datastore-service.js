// @flow
import type { DataStoreService } from './datastore-service.flow';
const promisify = require('es6-promisify');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');
const DiffMatchPatch = require('diff-match-patch');

const logger = require('melinda-deduplication-common/utils/logger');
const utils = require('melinda-deduplication-common/utils/utils');
const RecordUtils = require('melinda-deduplication-common/utils/marc-record-utils');
const initialDatabaseSchema = require('./schema/datastore-schema');
const createCandidateService = require('./candidate-service');

const migrations = '???';
const schemaVersion = 1;

function createDataStoreService(connection: any): DataStoreService {
  const query = promisify(connection.query, connection);
  const candidateService = createCandidateService(connection);
  const dmp = new DiffMatchPatch();

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

        for (const sqlString of initialDatabaseSchema) {
          logger.log('info', sqlString);
          await query(sqlString);
        }

        logger.log('info', 'Database initialized');
        return;
      }
      throw error;
    }
  }

  async function rebuildCandidateTerms() {
    return candidateService.rebuild();
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

  async function loadRecordMeta(base, recordId) {
    const results = await query('SELECT * from record where base=? and id=?', [base, recordId]);
    const meta = _.get(results, '[0]');
    if (meta === undefined) {
      throw NotFoundError();
    }
    return _.omit(meta, 'record');
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
 
  async function saveRecord(base, recordId, record) {
    logger.log('info', `Saving ${base}/${recordId} to database`);

    const now = Date.now();
    try {
      const currentRecord = await loadRecord(base, recordId);
      const currentRecordMeta = await loadRecordMeta(base, recordId);

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
      parentId: parseParentId(record),
      timestamp: now
    };
    
    await query(`
      insert into record (id, base, record, parentId, timestamp) 
        values (?,?,?,?,?) 
      ON DUPLICATE KEY UPDATE 
        record=values(record), 
        parentId=values(parentId), 
        timestamp=values(timestamp)`, 
      [
        row.id, 
        row.base, 
        row.record, 
        row.parentId, 
        row.timestamp
      ]);
    
    logger.log('info', `Record ${base}/${recordId} saved succesfully.`);

    await candidateService.update(base, recordId, record);
    
  }
  
  return {
    rebuildCandidateTerms,
    updateSchema,
    loadRecord,
    loadRecordByTimestamp,
    saveRecord,
    loadRecordHistory,
    loadCandidates: candidateService.loadCandidates
  };

}

// TODO
function parseParentId(record) {
  return '';
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



module.exports = createDataStoreService;

