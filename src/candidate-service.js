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
  
    for (const tableName of TABLE_NAMES) {
      await query(`delete from ${tableName}`);
    }
  
    const countRow = await query('select count(id) as recordCount from record');
    const recordCount = _.get(countRow, '[0].recordCount');
    
    const allRecordsStream = connection.query('select id, base, record from record');
    let current = 0;
    let stepSize = Math.ceil(recordCount / 1000);

    allRecordsStream
      .on('error', function(err) { throw err; })
      .on('result', async function(row) {
        
        current++;
        if (current % stepSize === 0) {
          const percent = Math.round(current / recordCount * 100 * 100) / 100;
          logger.log('info', `${current}/${recordCount} (${percent}%)`);
        }
        
        const record = MarcRecord.fromString(row.record);
        try {
          const quiet = true;
          await update(row.base, row.id, record, quiet);
        } catch(error) {
          logger.log('error', error.message, error);
        }
       
      })
      .on('end', () => {
        const percent = Math.round(current / recordCount * 100 * 100) / 100;
        logger.log('info', `${current}/${recordCount} (${percent}%)`);
        logger.log('into', 'Candidates rebuilt.');
      });
  }

  async function update(base, recordId, record, quiet=false) {
    if (!quiet) logger.log('info', `Resetting candidate query terms for ${base}/${recordId}`);
    
    const resetTerms = async (tableName, terms) => {
      await query(`delete from ${tableName} where id=? and base=?`, [recordId, base]);
      await query(`insert into ${tableName} (id, base, term) values (?,?,?)`, [recordId, base, terms]);
    };

    const termsByAuthor = createGroupingTermsByAuthor(record);
    const termsByTitle = createGroupingTermsByTitle(record);

    for (const term of termsByAuthor) {
      await resetTerms('candidatesByAuthor', term);
    }
    for (const term of termsByTitle) {
      await resetTerms('candidatesByTitle', term);
    }
    
    if (!quiet) logger.log('info', `Candidate terms reset done for ${base}/${recordId}`);
  }

  async function remove(base, recordId) {
    for (const tableName of TABLE_NAMES) {
      await query(`delete from ${tableName} where id=? and base=?`, [recordId, base]);
    }
  }

  async function loadCandidates(base, recordId) {
    const loadFromTable = async (tableName) => {
      const queriedItem = await query(`select * from ${tableName} where base=? and id=?`, [base, recordId]);
      if (queriedItem.length === 0) {
        return [];
      }
      const queryTerm = _.get(queriedItem, '[0].term');
      
      const candidatesBefore = await query(`select * from ${tableName} where base=? and term <= ? and id != ? order by term desc LIMIT ${CANDIDATE_CONTEXT_SIZE}`, [base, queryTerm, recordId]);
      const candidatesAfter = await query(`select * from ${tableName} where base=? and term >= ? and id != ? order by term asc LIMIT ${CANDIDATE_CONTEXT_SIZE}`, [base, queryTerm, recordId]);
      return _.concat(candidatesBefore, candidatesAfter).map(candidate => {
        
        return {
          first: {id: recordId, base: base, term: queryTerm},
          second: {id: candidate.id, base: candidate.base, term: candidate.term}
        };
      });
    };

    const byTitle = await loadFromTable('candidatesByTitle');
    const byAuthor = await loadFromTable('candidatesByAuthor');
    
    return _.uniqBy(_.concat(byTitle, byAuthor), candidate => `${candidate.second.base}${candidate.second.id}`);
    
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
    .replace(/[\][":;,.-?'=+/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .substr(0, 50);
}

function createGroupingTermsByTitle(record) {
  const term = _.chain(record.fields)
    .filter(field => field.tag === '245')
    .flatMap(field => field.subfields.filter(subfield => _.includes(['a', 'b'], subfield.code)))
    .map(subfield => normalizeForGrouping(subfield.value))
    .join(' ').value();

  return [term].filter(term => term.length > 1);
}

function createGroupingTermsByAuthor(record) {
  const term = _.chain(record.fields)
    .filter(field => _.includes(['100','110','111'], field.tag))
    .flatMap(field => field.subfields.filter(subfield => _.includes(['a', 'b'], subfield.code)))
    .map(subfield => normalizeForGrouping(subfield.value))
    .join(' ').value();
  return [term].filter(term => term.length > 1);
}

module.exports = createCandidateService;
