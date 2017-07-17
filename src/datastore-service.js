// @flow
import type { DataStoreService } from './datastore-service.flow';
const promisify = require('es6-promisify');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');
const logger = require('melinda-deduplication-common/utils/logger');

const utils = require('melinda-deduplication-common/utils/utils');
const initialDatabaseSchema = require('./schema/datastore-schema');

const migrations = '???';
const schemaVersion = 1;

function createDataStoreService(connection: any): DataStoreService {

  async function updateSchema() {
    const query = promisify(connection.query, connection);

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

  function loadRecord(base, recordId) {
    return new Promise((resolve, reject) => {

      connection.query('SELECT 1 + 1 AS solution', function (error, results) {
        if (error) {
          return reject(error);
        }
        const record = new MarcRecord();
        
        resolve(record);
      });      
    });
  }

  function saveRecord(base, recordId, record) {

  }    
  
  return {
    updateSchema,
    loadRecord,
    saveRecord,
  };
}

module.exports = createDataStoreService;

