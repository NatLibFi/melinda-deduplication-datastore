/* eslint-disable no-console */

const _ = require('lodash');
const fs = require('fs');
const Serializers = require('marc-record-serializers');
const mysql = require('mysql');
const createDataStoreService = require('../src/datastore-service');
const Utils = require('melinda-deduplication-common/utils/utils');

const [base, filename] = process.argv.slice(2);
if (!base) {
  throw new Error('Record base not defined');
}

if (!filename) {
  throw new Error('Filename not defined');
}

const SAVED_RECORDS_STORE = _.get(process.env, 'SAVED_RECORDS_STORE', '.load-aseq_saved-records-store');

const DATASTORE_MYSQL_HOST = _.get(process.env, 'DATASTORE_MYSQL_HOST');
const DATASTORE_MYSQL_PORT = _.get(process.env, 'DATASTORE_MYSQL_PORT', '3306');
const DATASTORE_MYSQL_USER = _.get(process.env, 'DATASTORE_MYSQL_USER');
const DATASTORE_MYSQL_PASSWORD = _.get(process.env, 'DATASTORE_MYSQL_PASSWORD');
const DATASTORE_MYSQL_DATABASE = _.get(process.env, 'DATASTORE_MYSQL_DATABASE');

const dbConnectionPoolConfiguration = {
  host: DATASTORE_MYSQL_HOST,
  user: DATASTORE_MYSQL_USER,
  password: DATASTORE_MYSQL_PASSWORD,
  database: DATASTORE_MYSQL_DATABASE,
  port: DATASTORE_MYSQL_PORT
};

let count = 0;
let averageTime = 0;

run(base, filename).catch(error => console.error(error));

async function run(base, filename) {

  const savedRecords = loadSavedRecords();
  
  console.log('adding aseq records from %s into %s', filename, base);
  
  const connectionPool = await getDBConnectionPool(dbConnectionPoolConfiguration);
  
  await ensureDatabaseIsOK(connectionPool);

  const dataStoreService = createDataStoreService(connectionPool);
  
  const fileStream = fs.createReadStream(filename);
  const reader = new Serializers.AlephSequential.Reader(fileStream);

  const queue = createQueue();

  reader.on('data', async function(record) {
    fileStream.pause();

    queue.add(record);
    process.nextTick(queue.handleQueuedTasks);
    queue.onEmpty(() => fileStream.resume());
  });

  reader.on('end', function() {
    console.log('Done.');
  });

  reader.on('error', function(error) {
    console.error(error);
  });

  function createQueue() {
    let tasks = [];
    let isRunning = false;
    let onEmptyCallback;
    
    const handleQueuedTasks = async () => {
      if (isRunning) return;
      isRunning = true;
      for (const record of tasks) {
        try {
          await triggerRecordSave(record);
        } catch(error) {
          console.log(error.message);
          console.log(record.toString());
        }
      }
      tasks = [];
      isRunning = false;
      
      if (onEmptyCallback) {
        onEmptyCallback.call();
      }
    };
    const add = (task) => tasks.push(task);
    const onEmpty = (fn) => onEmptyCallback = fn;

    return {
      add,
      handleQueuedTasks,
      onEmpty
    };
  }
  
  async function triggerRecordSave(record) {

    const recordId = _.get(record.fields.find(field => field.tag === '001'), 'value');
    if (recordId === undefined) {
      return;
    }
    if (recordHasBeenSavedAlready(recordId)) {
      return;
    }
    
    try {
      const start = Utils.hrtimeToMs(process.hrtime());

      const quiet = true;
      await dataStoreService.saveRecord(base, recordId, record, quiet);

      const end = Utils.hrtimeToMs(process.hrtime());
      const delta = end-start;
      averageTime = (averageTime*count + delta) / (++count);
      
      if (count % 100 === 0) {
        const rounded = Math.round(averageTime * 1000) / 1000;
        const perSecond = Math.round(1000/rounded * 10) / 10;
        const now = new Date().toString();
        console.log(`${now} Saved record ${base}/${recordId} in ${delta} ms (Saved count: ${count}) Average time per record ${rounded} ms (${perSecond} per second)`);
      }

      await markRecordAsSaved(recordId);

    } catch(error) {
      console.log(`Error saving record ${base}/${recordId}`);
      console.error(error);
    }

  }

  function recordHasBeenSavedAlready(recordId) {
    return savedRecords[recordId];
  }

  function markRecordAsSaved(recordId) {
    savedRecords[recordId] = true;
    fs.appendFileSync(SAVED_RECORDS_STORE, `${recordId}\n`, 'utf8');
  }

  function loadSavedRecords() {
    try {
      const data = fs.readFileSync(SAVED_RECORDS_STORE, 'utf8');
      return data.split('\n').reduce((saved, id) => {
        saved[id] = true;
        return saved;
      }, {});
    } catch(error) {
      return {};
    }
  }
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
