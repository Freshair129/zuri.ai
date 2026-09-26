export type SensitivityClass = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export type OperationalState = 'live' | 'snapshot' | 'candidate' | 'unavailable';

export interface CardCtaAction {
  label: string;
  uri: string;
  type: 'uri';
}

export interface CardViewModel {
  templateId: string;
  templateVersion: string;
  title: string;
  subtitle?: string;
  operationalState: OperationalState;
  sourceLabel: string;
  asOf: string;
  kpis?: Array<{
    label: string;
    value: string;
    delta?: string;
    status?: 'positive' | 'negative' | 'neutral' | 'warning';
  }>;
  items?: Array<{
    title: string;
    value?: string;
    subtitle?: string;
    badge?: string;
  }>;
  riskFlags?: string[];
  ctaButtons: CardCtaAction[];
}
