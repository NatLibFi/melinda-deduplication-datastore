const fs = require('fs');
const path = require('path');
const utils = require('melinda-deduplication-common/utils/utils');
const _ = require('lodash');
const promisify = require('es6-promisify');
const MarcRecord = require('marc-record-js');
const moment = require('moment');
const RecordUtils = require('melinda-deduplication-common/utils/record-utils');
const LineByLineReader = require('line-by-line');

function getMigrationCommands({from, to}) {
  if (from >= to) {
    throw new Error('Migrations to previous versions are not supported.');
  }
  const versions = _.concat(_.range(from, to), to);
  const versionUpdates = utils.chunkWithWindow(versions, 2);

  return _.flatMap(versionUpdates, ([from, to]) => {
    const migrationSQL = getMigrationSQL({from, to});
    const migrationFn = getMigrationFunctions({from, to});
    return { migrationSQL, migrationFn };
  });
}

function getMigrationSQL({from, to}) {
  const sqlFile = `migration-${from}-to-${to}.sql`;
  return fs.readFileSync(path.resolve(__dirname, sqlFile), 'utf8').split('\n').filter(line => line.length > 1);
}

function getMigrationFunctions({from, to}) {
  if (from === 5 && to === 6) {
    return migrateFrom5to6;    
  }
  return () => {};
}

function migrateFrom5to6(connectionPool, logger) {
  const getConnectionFromPool = promisify(connectionPool.getConnection, connectionPool);
  
  const query = async (...args) => {
    const connection = await getConnectionFromPool();
    const querySql = promisify(connection.query, connection);
    const result = await querySql(...args);
    connection.release();
    return result;
  };

  return new Promise(async (resolve, reject) => {

    const countRow = await query('select count(id) as recordCount from record');
    const recordCount = _.get(countRow, '[0].recordCount');
    
    const connection = await getConnectionFromPool();
    const allRecordsStream = connection.query('select id, base, record from record');
    let current = 0;
    let stepSize = Math.ceil(recordCount / 10000);

    const filename = `/tmp/migration-${Date.now()}.sql`;
    let data = [];

    allRecordsStream
      .on('error', function(err) { 
        connection.release();
        return reject(err);
      })
      .on('result', function(row) {
        
        current++;
        if (current % stepSize === 0) {
          const percent = Math.round(current / recordCount * 100 * 100) / 100;
          logger.log('info', `Saving to transient migration file ${current}/${recordCount} (${percent}%)`);
          fs.appendFileSync(filename, 
            data.map(d => `${d.recordTimestamp} ${d.base} ${d.id}`).join('\n')
          );
          data = [];
        }
        
        const record = MarcRecord.fromString(row.record);
        const recordTimestamp = moment(RecordUtils.getLastModificationDate(record)).format('YYYY-MM-DDTHH:mm:ss.SS');
        data.push({base: row.base, id: row.id, recordTimestamp});

      })
      .on('end', () => {
        
        updateDatabaseFromFile(logger, recordCount, filename, connection, () => { 
          connection.release();
          resolve(); 
        });
      });
  });
}

function updateDatabaseFromFile(logger, recordCount, filename, migrateConnection, cb) {

  let current = 0;
  let stepSize = Math.ceil(recordCount / 10000);
  
  const lr = new LineByLineReader(filename);
  lr.on('error', function (error) {
    logger.log('error', error.message, error);
    process.exit(1);
  });
  
  lr.on('line', function (line) {
    lr.pause();
    current++;
    if (current % stepSize === 0) {
      const percent = Math.round(current / recordCount * 100 * 100) / 100;
      logger.log('info', `Updating database from transient migration file ${current}/${recordCount} (${percent}%)`);
    }
    const [recordTimestamp, base, id] = line.split(' ');
  
    migrateConnection.query('update record set recordTimestamp=? where base=? and id=?', 
      [recordTimestamp, base, id],
      error => {
        if (error) {
          logger.log('error', error.message, error);
        }
        lr.resume();
      });
  });
  
  lr.on('end', function () {
    logger.log('info', `Migration completed ${current}/${recordCount}`);
    cb();
  });
}

module.exports = getMigrationCommands;