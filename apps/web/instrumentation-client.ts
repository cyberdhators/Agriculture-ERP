import * as Sentry from '@sentry/nextjs';

import { sharedOptions } from './sentry.shared';

// Browser runtime. Next loads this before the app hydrates.
Sentry.init(sharedOptions);
