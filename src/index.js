// @flow

const mysql = require('mysql');

const logger = require('melinda-deduplication-common/utils/logger');
logger.log('info', 'Starting melinda-deduplication-datastore');

const utils = require('melinda-deduplication-common/utils/utils');
const { createDataStoreService } = require('./datastore-service');
const createHTTPService = require('./http-service');

const DATASTORE_HTTP_PORT = utils.readEnvironmentVariable('DATASTORE_HTTP_PORT', 8080);

const DATASTORE_MYSQL_HOST = utils.readEnvironmentVariable('DATASTORE_MYSQL_HOST');
const DATASTORE_MYSQL_PORT = utils.readEnvironmentVariable('DATASTORE_MYSQL_PORT', 3306);
const DATASTORE_MYSQL_USER = utils.readEnvironmentVariable('DATASTORE_MYSQL_USER');
const DATASTORE_MYSQL_PASSWORD = utils.readEnvironmentVariable('DATASTORE_MYSQL_PASSWORD');
const DATASTORE_MYSQL_DATABASE = utils.readEnvironmentVariable('DATASTORE_MYSQL_DATABASE');

const REBUILD_CANDIDATE_TERMS =  utils.readEnvironmentVariable('REBUILD_CANDIDATE_TERMS', false);
const TEMP_TABLES_LIFETIME = utils.readEnvironmentVariable('TEMP_TABLES_LIFETIME', 18000);

const dbConnectionPoolConfiguration = {
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
  
  const connectionPool = await utils.waitAndRetry(() => getDBConnectionPool(dbConnectionPoolConfiguration), onRetry, 10000);
  
  await utils.waitAndRetry(() => ensureDatabaseIsOK(connectionPool), onRetry, 10000);
  logger.log('info', `Database connection ready: ${DATASTORE_MYSQL_HOST}:${DATASTORE_MYSQL_PORT}/${DATASTORE_MYSQL_DATABASE}`);
  

  const dataStoreService = createDataStoreService(connectionPool);
  await dataStoreService.updateSchema();
  if (REBUILD_CANDIDATE_TERMS) {
    await dataStoreService.rebuildCandidateTerms();
  }
  
  await dataStoreService.createTempTablesMeta();
  setInterval(dataStoreService.dropTempTables, TEMP_TABLES_LIFETIME, TEMP_TABLES_LIFETIME);
  
  const httpService = createHTTPService(dataStoreService);

  await httpService.listen(DATASTORE_HTTP_PORT);
  logger.log('info', `HTTP Service listening on port ${DATASTORE_HTTP_PORT}`);
  
}

function ensureDatabaseIsOK(connectionPool) {
  return new Promise((resolve, reject) => {
    connectionPool.getConnection((err, connection) => {
      if (err) {
        reject(err);
      } else {
        connection.release();
        resolve();
      }
    });
  });
}

function getDBConnectionPool(config) {
  return new Promise((resolve) => {
    const connectionPool = mysql.createPool(config);
    resolve(connectionPool);
  });
}
