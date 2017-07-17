// @flow
import type { MarcRecord } from 'types/marc-record.flow';
import type { DuplicateCandidate } from 'types/duplicate-candidate.flow';

export type DataStoreService = {
    updateSchema: () => Promise<any>,
    saveRecord: (base: string, recordId: string, record: MarcRecord) => Promise<any>,
    loadRecord: (base: string, recordId: string) => Promise<MarcRecord>,
    loadCandidates: (base: string, recordId: string) => Promise<Array<DuplicateCandidate>>
};
