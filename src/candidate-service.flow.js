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
import type { MarcRecord } from '@natlibfi/melinda-deduplication-common/types/marc-record.flow';
import type { DuplicateCandidate } from '@natlibfi/melinda-deduplication-common/types/duplicate-candidate.flow';

export type CandidateService = {
  rebuild: () => Promise<any>,
  update: (base: string, recordId: string, record: MarcRecord, quiet: boolean) => Promise<any>,
  remove: (base: string, recordId: string) => Promise<any>,
  loadCandidates: (base: string, recordId: string) => Promise<Array<DuplicateCandidate>>
};
