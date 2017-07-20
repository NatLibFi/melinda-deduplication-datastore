// @flow
import type { MarcRecord } from 'types/marc-record.flow';
import type { DuplicateCandidate } from 'types/duplicate-candidate.flow';

export type CandidateService = {
  rebuild: () => Promise<any>,
  update: (base: string, recordId: string, record: MarcRecord) => Promise<any>,
  remove: (base: string, recordId: string) => Promise<any>,
  loadCandidates: (base: string, recordId: string) => Promise<Array<DuplicateCandidate>>
};
