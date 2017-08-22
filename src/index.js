// @flow

const mysql = require('mysql');

const logger = require('melinda-deduplication-common/utils/logger');
logger.log('info', 'Starting melinda-deduplication-datastore');

const utils = require('melinda-deduplication-common/utils/utils');
const createDataStoreService = require('./datastore-service');
const createHTTPService = require('./http-service');

const DATASTORE_HTTP_PORT = utils.readEnvironmentVariable('DATASTORE_HTTP_PORT', 8080);

const DATASTORE_MYSQL_HOST = utils.readEnvironmentVariable('DATASTORE_MYSQL_HOST');
const DATASTORE_MYSQL_USER = utils.readEnvironmentVariable('DATASTORE_MYSQL_USER');
const DATASTORE_MYSQL_PASSWORD = utils.readEnvironmentVariable('DATASTORE_MYSQL_PASSWORD');
const DATASTORE_MYSQL_DATABASE = utils.readEnvironmentVariable('DATASTORE_MYSQL_DATABASE');

const REBUILD_CANDIDATE_TERMS =  utils.readEnvironmentVariable('REBUILD_CANDIDATE_TERMS', false);

const dbConnectionConfiguration = {
  host: DATASTORE_MYSQL_HOST,
  user: DATASTORE_MYSQL_USER,
  password: DATASTORE_MYSQL_PASSWORD,
  database: DATASTORE_MYSQL_DATABASE
};

start().catch(error => logger.log('error', error.message, error));

async function start() {

  const onRetry = (error) => logger.log('warn', error);
  
  const connection = await utils.waitAndRetry(() => getDBConnection(dbConnectionConfiguration), onRetry);
  
  const dataStoreService = createDataStoreService(connection);
  await dataStoreService.updateSchema();
  if (REBUILD_CANDIDATE_TERMS) {
    await dataStoreService.rebuildCandidateTerms();
  }
  
  const httpService = createHTTPService(dataStoreService);

  await httpService.listen(DATASTORE_HTTP_PORT);
  logger.log('info', `HTTP Service listening on port ${DATASTORE_HTTP_PORT}`);

}


function getDBConnection(config) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(config);

    connection.connect((err) => {
      if (err) {
        return reject(err);
      }
      resolve(connection);
    });
  });
}
