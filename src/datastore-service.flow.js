// @flow
import type { MarcRecord } from 'types/marc-record.flow';
import type { DuplicateCandidate } from 'types/duplicate-candidate.flow';

export type DataStoreService = {
    updateSchema: () => Promise<any>,
    saveRecord: (base: string, recordId: string, record: MarcRecord) => Promise<any>,
    loadRecordsResume: (tempTable: string, {limit?: number|void, offset?: number, includeMetadata?: boolean, metadataOnly?: boolean}) => Promise<any|Array<MarcRecord|any>>,
    loadRecords: (base: string, {queryCallback: Function, limit?: number|void, includeMetadata?: boolean, metadataOnly?: boolean}) => Promise<any|Array<MarcRecord|any>>,
    getEarliestRecordTimestamp: (base: string) => Promise<Object>,
    getLatestRecordTimestamp: (base: string) => Promise<Object>,
    loadRecord: (base: string, recordId: string, includeMetadata: boolean) => Promise<MarcRecord|any>,
    loadRecordByTimestamp: (base: string, recordId: string, timestamp: number) => Promise<MarcRecord>,
    loadRecordHistory: (base: string, recordId: string) => Promise<Array<any>>,
    loadCandidates: (base: string, recordId: string) => Promise<Array<DuplicateCandidate>>,
    rebuildCandidateTerms: () => Promise<any>,
    dropTempTables: (lifetime?: number) => Promise<any>,
    createTempTablesMeta: () => Promise<any>
};