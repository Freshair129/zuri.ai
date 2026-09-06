import { SensitivityClass } from '../zuri-api/types.js';

export interface QueryParameterSchema {
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month';
  limit?: number;
  [key: string]: unknown;
}

export interface RegisteredQuery {
  queryId: string;
  version: string;
  description: string;
  sensitivity: SensitivityClass;
  allowedColumns: string[];
  maxRowCap: number;
  sqlTemplate: string;
  validateParameters: (params: Record<string, unknown>) => { valid: boolean; error?: string };
}
