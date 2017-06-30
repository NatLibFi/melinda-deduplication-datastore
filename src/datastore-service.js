// @flow
import type { DataStoreService } from './datastore-service.flow';

function createDataStoreService(connection: any): DataStoreService {

  function updateSchema() {
    // load schema info
    // check if schema update required
    // run migration
  }

  function loadRecord(base, recordId) {
    return new Promise((resolve, reject) => {

      connection.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
        if (error) {
          return reject(error);
        }
        resolve(results[0].solution);
      });      
    });
  }
  
  return {
    updateSchema,
    loadRecord
  };
}

module.exports = createDataStoreService;

