// @flow
import type { DataStoreService } from './datastore-service.flow';

const promisify = require('es6-promisify');
const express = require('express');
const bodyParser = require('body-parser');
const HttpStatus = require('http-status-codes');
const MarcRecord = require('marc-record-js');
const debug = require('debug')('http-service');
const logger = require('melinda-deduplication-common/utils/logger');

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

  app.get('/record/:base/:id', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    logger.log('info', 'get request for record', req.params);

    try {
      const record = await dataStoreService.loadRecord(base, recordId);
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

  app.put('/record/:base/:id', async function (req, res) {
    const base = req.params.base;
    const recordId = req.params.id;
    logger.log('info', 'put request for record', req.params);

    try  {
      
      const record = parseRecord(req.body);
      debug(`Record:\n${record.toString()}`);

      await dataStoreService.saveRecord(base, recordId, record);
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