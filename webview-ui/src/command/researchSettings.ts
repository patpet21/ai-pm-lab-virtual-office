export interface ResearchSettings {
  count: number;
  cap: number;
  area: string;
  sectors: string;
  exclusions: string;
  quality: 'selective' | 'exploratory';
  output: 'sheets' | 'offline' | 'chat';
}

export const defaultResearch: ResearchSettings = {
  count: 10,
  cap: 60,
  area: 'NYC: Queens e Brooklyn',
  sectors: 'Property manager indipendenti, contractor locali e piccoli studi di progettazione',
  exclusions:
    'Lead broker, conglomerati, franchising senza autonomia locale e aziende già presenti o soppresse',
  quality: 'selective',
  output: 'sheets',
};
