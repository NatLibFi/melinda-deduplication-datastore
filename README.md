# Datastore microservice of Melinda deduplication system [![NPM Version](https://img.shields.io/npm/v/@natlibfi/melinda-deduplication-datastore.svg)](https://npmjs.org/package/@natlibfi/melinda-deduplication-datastore) [![Build Status](https://travis-ci.org/NatLibFi/melinda-deduplication-datastore.svg)](https://travis-ci.org/NatLibFi/melinda-deduplication-datastore)

Datastore microservice of Melinda deduplication system. See [documentation(https://natlibfi.github.io/melinda-deduplication).

## Installation
```
npm install
npm run build
```

### Building a container image
([acbuild](https://github.com/containers/build) must be in PATH)
```
bin/build-aci.sh
```

## Running
```
bin/start
```

### Configuration
The following environment variables are used to configure the system:

| name | mandatory | description | default |
|---|---|---|---|
| DATASTORE_HTTP_PORT | | X | 8080 |
| REBUILD_CANDIDATE_TERM | | X | false |
| TEMP_TABLES_LIFETIME | | X | 300000 |
| DATASTORE_MYSQL_HOST | x | X | -
| DATASTORE_MYSQL_PORT |  | X | X
| DATASTORE_MYSQL_USER | x | X | -
| DATASTORE_MYSQL_PASSWORD | x | X | -
| DATASTORE_MYSQL_DATABASE | x | X | -

## License and copyright

Copyright (c) 2017 **University Of Helsinki (The National Library Of Finland)**

This project's source code is licensed under the terms of **GNU Affero General Public License Version 3** or any later version.