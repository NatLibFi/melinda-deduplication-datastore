const promisify = require('es6-promisify');
const express = require('express');
const debug = require('debug')('http-service');

function createHTTPService(dataStoreService) {
  const app = express();
  const listen = promisify(app.listen, app);

  app.get('/', async function (req, res) {
    debug('request');

    const solution = await dataStoreService.loadRecord("", "");
    res.send(`The solution is: ${solution}`);

  });

  return {
    listen
  };
}

module.exports = createHTTPService;