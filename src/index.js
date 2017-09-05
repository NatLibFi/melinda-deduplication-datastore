// @flow

const mysql = require('mysql');

const logger = require('melinda-deduplication-common/utils/logger');
logger.log('info', 'Starting melinda-deduplication-datastore');

const utils = require('melinda-deduplication-common/utils/utils');
const createDataStoreService = require('./datastore-service');
const createHTTPService = require('./http-service');

const DATASTORE_HTTP_PORT = utils.readEnvironmentVariable('DATASTORE_HTTP_PORT', 8080);

const DATASTORE_MYSQL_HOST = utils.readEnvironmentVariable('DATASTORE_MYSQL_HOST');
const DATASTORE_MYSQL_PORT = utils.readEnvironmentVariable('DATASTORE_MYSQL_PORT', 3306);
const DATASTORE_MYSQL_USER = utils.readEnvironmentVariable('DATASTORE_MYSQL_USER');
const DATASTORE_MYSQL_PASSWORD = utils.readEnvironmentVariable('DATASTORE_MYSQL_PASSWORD');
const DATASTORE_MYSQL_DATABASE = utils.readEnvironmentVariable('DATASTORE_MYSQL_DATABASE');

const REBUILD_CANDIDATE_TERMS =  utils.readEnvironmentVariable('REBUILD_CANDIDATE_TERMS', false);

const dbConnectionConfiguration = {
  host: DATASTORE_MYSQL_HOST,
  user: DATASTORE_MYSQL_USER,
  password: DATASTORE_MYSQL_PASSWORD,
  database: DATASTORE_MYSQL_DATABASE,
  port: DATASTORE_MYSQL_PORT
};

startApp();

function startApp() {
  startDatastore().catch(error => logger.log('error', error.message, error));
}

async function startDatastore() {

  const onRetry = (error) => logger.log('warn', `Failed to connect to database: ${error.message}. Retrying.`);
  
  const connection = await utils.waitAndRetry(() => getDBConnection(dbConnectionConfiguration), onRetry, 10000);
  connection.on('error', (error) => {
    if (error.code === 'PROTOCOL_CONNECTION_LOST') {
      logger.log('warn', 'Connection to database lost. Reconnecting.');
      httpService.close();
      startApp();
    } else {
      logger.log('error', error.message, error);
      process.exit(1);
    }
  });
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
