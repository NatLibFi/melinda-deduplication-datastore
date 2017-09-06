const fs = require('fs');
const path = require('path');
const utils = require('melinda-deduplication-common/utils/utils');
const _ = require('lodash');

function getMigrationCommands({from, to}) {
  if (from >= to) {
    throw new Error('Migrations to previous versions are not supported.');
  }
  const versions = _.concat(_.range(from, to), to);
  const versionUpdates = utils.chunkWithWindow(versions, 2);

  return _.flatMap(versionUpdates, ([from, to]) => {
    const file = `migration-${from}-to-${to}.sql`;
    return fs.readFileSync(path.resolve(__dirname, file), 'utf8').split('\n').filter(line => line.length > 1);
  });
}

module.exports = getMigrationCommands;
