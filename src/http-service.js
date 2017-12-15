/**
 *
 * @licstart  The following is the entire license notice for the JavaScript code in this file. 
 *
 * Datastore microservice of Melinda deduplication system
 *
 * Copyright (c) 2017 University Of Helsinki (The National Library Of Finland)
 *
 * This file is part of melinda-deduplication-datastore
 *
 * melinda-deduplication-datastore is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *  
 * melinda-deduplication-datastore is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *  
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @licend  The above is the entire license notice
 * for the JavaScript code in this file.
 *
 **/
// @flow
import type { DataStoreService } from './datastore-service.flow';

const express = require('express');
const bodyParser = require('body-parser');
const HttpStatus = require('http-status-codes');
const MarcRecord = require('marc-record-js');
const moment = require('moment');
const debug = require('debug')('http-service');
const logger = require('@natlibfi/melinda-deduplication-common/utils/logger');
const { DATASTORE_CHANGE_TIMESTAMP_FORMAT } = require('@natlibfi/melinda-deduplication-common/utils/datastore-connector');

function createHTTPService(dataStoreService: DataStoreService) {
  const app = express();
  let server;
  const listen = (port: number) => {
    return new Promise((resolve, reject) => {
      server = app.listen(port, (err, ok) => {
        if(err) {
          return reject(err);
        } else {
          resolve(ok);
        }
      });
    });
  };
  const close = () => server.close();

  app.use(bodyParser.json({ limit: '1000kb' }));
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError) {
      logger.log('info', 'The client sent invalid json as request body:', error.message);
      res.sendStatus(error.statusCode);
    } else {
      next();
    }
  });
  
  app.get('/records/:base/', async function (req, res) {
    const base = req.params.base;
    
    logger.log('info', 'get request for records', req.params);
    
    try {
      const limit = Number.isInteger(Number(req.query.limit)) ? Number(req.query.limit) : undefined;      
      const includeMetadata = req.query.includeMetadata === '1' || req.query.includeMetadata === 'true';
      const metadataOnly = req.query.metadataOnly === '1' || req.query.metadataOnly === 'true';          
      
      if (req.query.tempTable) {
        const offset = Number.isInteger(Number(req.query.offset)) ? Number(req.query.offset) : undefined;
        const records = await dataStoreService.loadRecordsResume(req.query.tempTable, { limit, offset, includeMetadata, metadataOnly }); 
        res.send(records); 
      } else {
        const queryCallback = generateQueryCallback();
        const records = await dataStoreService.loadRecords(base, { queryCallback, limit, includeMetadata, metadataOnly });
        if (records.length === 0) {
          res.sendStatus(HttpStatus.NOT_FOUND); 
        } else {
          res.send(records);
        }
      }      
    } catch(error) {
      if (error.message === 'Invalid date') {
        res.status(HttpStatus.BAD_REQUEST);
        res.send({ error: 'Invalid date' });
      } else if (error.code === 'ER_NO_SUCH_TABLE') {
        res.status(HttpStatus.BAD_REQUEST);
        res.send({ error: 'Temporary table does not exist' });
      } else {
        logger.log('error', error);
        res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
    
    function parseTimestamp(timestamp, dayStart=true) {
      const parsed = moment(timestamp);
      /* If the time portion is missing and the timestamp is a day end constraint we want to set the time portion to last millisecond */
      if (!/T/.test(timestamp) && !dayStart) {        
        parsed.hour(23).minutes(59).seconds(59).milliseconds(999);
      }
      return parsed;
    }
    
    function generateQueryCallback() {      
      const args = [];
      let newQuery = '';
      
      if (req.query.startTime) {
        const startTime = parseTimestamp(req.query.startTime);
        if (startTime.isValid()) {
          newQuery += ' and recordTimestamp >= ?';
          //args.push(startTime.format(RECORD_TIMESTAMP_FORMAT));
        } else {
          throw new Error('Invalid date');
        }
      }
      
      if (req.query.endTime) {
        const endTime = parseTimestamp(req.query.endTime);
        if (endTime.isValid()) {
          newQuery += ' and recordTimestamp <= ?';
          // args.push(endTime.format(RECORD_TIMESTAMP_FORMAT));
        } else {
          throw new Error('Invalid date');
        }
      }
      
      if (req.query.low) {
        const lowTags = [].concat(req.query.low);
        args.push(lowTags.join('|'));        
        newQuery += ' and lowTags regexp ?';  
      }
      
      return query => { return { statement: query+newQuery, args };};
    }
  });

  app.get('/record/:base/:id', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
     
    logger.log('info', 'get request for record', req.params);

    try {
      const includeMetadata = req.query.includeMetadata === '1' || req.query.includeMetadata === 'true';
      const record = await dataStoreService.loadRecord(base, recordId, includeMetadata);      
      res.send(record);
    } catch(error) {
      if (error.name === 'NOT_FOUND') {
        logger.log('info', 'record not found');
        return res.sendStatus(HttpStatus.NOT_FOUND);
      }
      logger.log('error', error);
      res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  app.get('/record/:base/:id/version/:timestamp', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    const timestamp = parseInt(req.params.timestamp);
    
    logger.log('info', 'get request for specific version of record', req.params);

    try {
      const record = await dataStoreService.loadRecordByTimestamp(base, recordId, timestamp);
      res.send(record);
    } catch(error) {
      if (error.name === 'NOT_FOUND') {
        logger.log('info', 'record not found');
        return res.sendStatus(HttpStatus.NOT_FOUND);
      }
      logger.log('error', error);
      res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });
  
  app.get('/lowtags', async function (req, res) {
    logger.log('info', 'get request for low tags');

    try  {            
      const lowTags = await dataStoreService.getLowTags();
      res.status(HttpStatus.OK);
      res.json(lowTags);
    } catch (error) {
      if (error.name === 'NOT_FOUND') {
        return res.sendStatus(HttpStatus.NOT_FOUND);
      } else {
        logger.log('error', error);
        return res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  });

  app.get('/records/:base/timestamps/earliest', async function (req, res) {
    const base = req.params.base;
    logger.log('info', 'get request for earliest record timestamp', req.params);

    try  {            
      const timestamp = await dataStoreService.getEarliestRecordTimestamp(base);
      res.status(HttpStatus.OK);
      res.json({ timestamp });
    } catch (error) {
      logger.log('error', error);
      return res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });
  
  app.get('/records/:base/timestamps/latest', async function (req, res) {
    const base = req.params.base;
    logger.log('info', 'get request for latest record timestamp', req.params);

    try  {            
      const timestamp = await dataStoreService.getLatestRecordTimestamp(base);
      res.status(HttpStatus.OK);
      res.json({ timestamp });
    } catch (error) {
      logger.log('error', error);
      return res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  app.put('/record/:base/:id', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    logger.log('info', 'put request for record', req.params);

    try  {
      
      const changeType = req.query.changeType;
      const changeTimestamp = moment(req.query.changeTimestamp, DATASTORE_CHANGE_TIMESTAMP_FORMAT);
      
      if (!changeTimestamp.isValid()) {
        return res.sendStatus(HttpStatus.BAD_REQUEST);
      }
      
      const record = parseRecord(req.body);
      debug(`Record:\n${record.toString()}`);

      await dataStoreService.saveRecord(base, recordId, record, changeType, changeTimestamp);
      res.sendStatus(HttpStatus.OK);

    } catch(error) {
      if (error.name === 'ParseRecordError') {
        logger.log('info', error.message);
        return res.sendStatus(HttpStatus.BAD_REQUEST);
      }
      if (error.name === 'RecordIsOlderError') {
        logger.log('info', 'Not saving the record since it is older than the currently stored record.');
        return res.status(HttpStatus.BAD_REQUEST).send('Record is older than the currently stored record');
      }
      logger.log('error', error);
      return res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  app.get('/record/:base/:id/history', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    logger.log('info', 'get request of history for record', req.params);

    try {
      const history = await dataStoreService.loadRecordHistory(base, recordId);
      res.send(history);
    } catch(error) {
      if (error.name === 'NOT_FOUND') {
        logger.log('info', 'record not found');
        return res.sendStatus(HttpStatus.NOT_FOUND);
      }
      logger.log('error', error);
      res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }

  });
  app.get('/candidates/:base/:id', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    logger.log('info', 'get request for candidates', req.params);

    const candidates = await dataStoreService.loadCandidates(base, recordId);
    return res.send(candidates);
  });

  function parseRecord(requestBody) {
    try {
      return new MarcRecord(requestBody);
    } catch(error) {
      const parseRecordError = new Error('Failed to parse marc record from body');
      parseRecordError.name = 'ParseRecordError';
      throw parseRecordError;
    }
  }

  return {
    listen,
    close
  };
}

module.exports = createHTTPService;