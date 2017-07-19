// @flow
import type { CandidateService } from './candidate-service.flow';
const promisify = require('es6-promisify');
const normalize = require('normalize-strings');
const _ = require('lodash');
const MarcRecord = require('marc-record-js');

const logger = require('melinda-deduplication-common/utils/logger');
const CANDIDATE_CONTEXT_SIZE = 4;

const TABLE_NAMES = ['candidatesByAuthor', 'candidatesByTitle'];

function createCandidateService(connection: any): CandidateService {

  const query = promisify(connection.query, connection);

  async function rebuild() {
    const allRecords = await query('select id, base, record from record');
    for (const row of allRecords) {
      const record = MarcRecord.fromString(row.record);
      await update(row.base, row.id, record);
    }
  }

  async function update(base, recordId, record) {
    logger.log('info', `Resetting candidate query terms for ${base}/${recordId}`);

    const resetTerms = async (tableName, terms) => {

      await query(`delete from ${tableName} where id=? and base=?`, [recordId, base]);
      await query(`insert into ${tableName} (id, base, term) values (?,?,?)`, [recordId, base, terms]);

    };

    const byAuthor = createGroupingByAuthor(record);
    const byTitle = createGroupingByTitle(record);
    
    await resetTerms('candidatesByAuthor', byAuthor);
    await resetTerms('candidatesByTitle', byTitle);
    logger.log('info', `Candidate terms reset done for ${base}/${recordId}`);
  }

  async function remove(base, recordId) {
    for (const tableName of TABLE_NAMES) {
      await query(`delete from ${tableName} where id=? and base=?`, [recordId, base]);
    }
  }

  async function loadCandidates(base, recordId) {
    const loadFromTable = async (tableName) => {
      const candidatesBefore = await query(`select * from ${tableName} where base=? and id < ? order by term desc LIMIT ${CANDIDATE_CONTEXT_SIZE}`, [base, recordId]);
      const candidatesAfter = await query(`select * from ${tableName} where base=? and id > ? order by term asc LIMIT ${CANDIDATE_CONTEXT_SIZE}`, [base, recordId]);
      return _.concat(candidatesBefore, candidatesAfter).map(candidate => {
        const {id, base, term} = candidate;
        return {id, base, term};
      });
    };


    const byTitle = await loadFromTable('candidatesByTitle');
    const byAuthor = await loadFromTable('candidatesByAuthor');
    
    return _.uniqBy(_.concat(byTitle, byAuthor), candidate => `${candidate.base}${candidate.id}`);
    
  }

  return {
    loadCandidates,
    update,
    remove,
    rebuild
  };
}


function normalizeForGrouping(string) {
  return normalize(string.normalize('NFC'))
    .replace(/[\][":;,.-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .substr(0, 50);
}

function createGroupingByTitle(record) {
  return _.chain(record.fields)
    .filter(field => field.tag === '245')
    .flatMap(field => field.subfields.filter(subfield => _.includes(['a', 'b'], subfield.code)))
    .map(subfield => normalizeForGrouping(subfield.value))
    .join(' ').value();
}

function createGroupingByAuthor(record) {
  return _.chain(record.fields)
    .filter(field => _.includes(['100','110','111'], field.tag))
    .flatMap(field => field.subfields.filter(subfield => _.includes(['a', 'b'], subfield.code)))
    .map(subfield => normalizeForGrouping(subfield.value))
    .join(' ').value();
}

module.exports = createCandidateService;