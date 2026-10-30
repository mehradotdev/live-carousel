import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.interval('expire temporary media', { hours: 1 }, internal.media.expire, {});
crons.interval(
  'remove old email content',
  { hours: 24 },
  internal.maintenance.cleanEmailHistory,
  {},
);
export default crons;
