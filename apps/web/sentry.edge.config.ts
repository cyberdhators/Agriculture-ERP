import * as Sentry from '@sentry/nextjs';

import { sharedOptions } from './sentry.shared';

// Edge runtime (middleware and edge routes). Loaded by instrumentation.ts.
Sentry.init(sharedOptions);
