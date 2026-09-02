import * as Sentry from '@sentry/nextjs';

import { sharedOptions } from './sentry.shared';

// Node runtime. Loaded by instrumentation.ts.
Sentry.init(sharedOptions);
