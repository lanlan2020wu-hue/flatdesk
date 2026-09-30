// Quality review's limits. Kept apart from lib/quality.ts so marketing pages
// can use them without pulling in the database.

export const QUALITY = {
  perAgent: 400, // reviews per seat per month, pooled
  trialSeatCap: 10, // a trial's limit is sized from at most this many people
  lookbackDays: 14, // replies older than this aren't reviewed after the fact
  perRun: 5, // reviews one background run makes
  threadChars: 16_000, // the most conversation text one review reads
  flagAt: 2, // an overall score at or below this is flagged
};
