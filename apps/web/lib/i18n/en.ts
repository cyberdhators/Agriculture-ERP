/**
 * The English interface strings for the farmer flow. This is the base
 * dictionary: every key the flow uses lives here, and `ar-juba.ts` overrides
 * only the handful of keys CORWADO has supplied translated text for. English
 * is the fallback for everything else, on purpose (see ar-juba.ts).
 */
export const en = {
  // Wordmark / shell
  'brand.org': 'CORWADO',
  'brand.tagline': 'Agricultural Register',
  'shell.staffSignIn': 'Staff sign in',
  'shell.previewFlag': 'Preview build — fixture data, nothing is saved',

  // Language screen
  'language.name': 'English',
  'language.arjubaName': 'Arabi Juba',
  'language.arjubaNative': 'عربي جوبا',
  'language.title': 'Choose your language',
  'language.subtitle': 'You can change this later in your account.',
  'language.continue': 'Continue',

  // Login
  'login.title': 'Sign in',
  'login.phoneLabel': 'Phone number',
  'login.phoneHint': 'The number you registered with.',
  'login.sendCode': 'Send code',
  'login.codeTitle': 'Enter your code',
  'login.codeSentTo': 'We sent a 6-digit code by SMS to',
  'login.codeLabel': 'Six-digit code',
  'login.verify': 'Sign in',
  'login.resendIn': 'Resend code in',
  'login.resend': 'Send a new code',
  'login.expiresIn': 'This code expires in',
  'login.expired': 'That code has expired. Send a new one.',
  'login.wrongCode': 'That code is not right. Try again.',
  'login.lockout': 'Too many wrong codes. Wait and send a new code.',
  'login.changeNumber': 'Use a different number',
  'login.newHere': 'New here?',
  'login.register': 'Register',
  'login.seconds': 'seconds',

  // Register
  'register.title': 'Register',
  'register.step': 'Step',
  'register.of': 'of',
  'register.stepName': 'Your name',
  'register.stepContact': 'Phone and place',
  'register.stepConsent': 'Agree and finish',
  'register.given': 'Given name',
  'register.family': 'Family name',
  'register.sex': 'Sex',
  'register.female': 'Female',
  'register.male': 'Male',
  'register.select': 'Select…',
  'register.yob': 'Year of birth',
  'register.yobHint': 'Four digits, for example 1994.',
  'register.phone': 'Phone number',
  'register.state': 'State',
  'register.county': 'County',
  'register.payam': 'Payam',
  'register.consentTitle': 'Your agreement',
  'register.agree': 'I agree',
  'register.back': 'Back',
  'register.next': 'Next',
  'register.submit': 'Register',
  'register.doneTitle': 'Registered — pending verification',
  'register.doneBody':
    'Thank you. An officer will check your details and verify your account. Until then your account is pending: you can add produce as a draft, but it goes live once you are verified.',
  'register.doneNumber': 'Your farmer number',
  'register.donePending': 'assigned once verified',
  'register.goToAccount': 'Go to my account',

  // Consent statement (the v1.0-en text)
  'consent.body':
    'CORWADO records your name, phone number, place and the crops you grow, so that an agricultural officer can verify you, map your farm and connect you to markets, inputs and advice. Your details are kept by CORWADO and shared only with the officers and partners running this programme. You may ask to see or remove your record at any time. Registering means you agree to this.',

  // Account
  'account.title': 'My account',
  'account.pending': 'Pending',
  'account.verified': 'Verified',
  'account.rejected': 'Not verified',
  'account.whatPendingTitle': 'What "pending" means',
  'account.whatPendingBody':
    'An officer has not yet checked your account. You can add produce as a draft now; each draft goes live once you are verified. This usually takes a few days.',
  'account.whatRejectedBody':
    'An officer could not verify your account. Contact your local CORWADO officer, or change your details and ask to be checked again.',
  'account.name': 'Name',
  'account.phone': 'Phone',
  'account.payam': 'Payam',
  'account.farms': 'My farms',
  'account.noFarms': 'No farm has been mapped for you yet. An officer maps your farm on a visit.',
  'account.listings': 'My produce',
  'account.listingsSummary': 'produce listings',
  'account.viewListings': 'View my produce',
  'account.actions': 'Account',
  'account.changeLanguage': 'Change language',
  'account.changePhone': 'Change phone number',
  'account.changePhoneNote':
    'Changing your phone number means signing in again with a new code, so we know it is you.',
  'account.signOut': 'Sign out',

  // Listings
  'listings.title': 'My produce',
  'listings.new': 'Add produce',
  'listings.empty': 'You have not added any produce yet.',
  'listings.emptyAction': 'Add your first produce',
  'listings.crop': 'Crop',
  'listings.quantity': 'Quantity',
  'listings.price': 'Price',
  'listings.available': 'Available',
  'listings.status': 'Status',
  'listings.edit': 'Edit',
  'listings.kg': 'kg',
  'listings.perKg': 'SSP / kg',
  'listings.noPrice': 'No price set',
  'listings.from': 'from',
  'listings.until': 'until',
  'listings.ongoing': 'ongoing',

  // Listing statuses
  'status.draft': 'Draft',
  'status.listed': 'Listed',
  'status.withdrawn': 'Withdrawn',
  'status.sold': 'Sold',

  // Listing form
  'listingForm.newTitle': 'Add produce',
  'listingForm.editTitle': 'Edit produce',
  'listingForm.cropLabel': 'Which crop?',
  'listingForm.quantityLabel': 'How many kilograms?',
  'listingForm.priceLabel': 'Price per kilogram',
  'listingForm.priceUnit': 'SSP',
  'listingForm.availableFrom': 'Available from',
  'listingForm.availableUntil': 'Available until',
  'listingForm.notes': 'Notes for buyers',
  'listingForm.notesHint': 'For example collection point, grade, or how to reach you.',
  'listingForm.photo': 'Photo',
  'listingForm.photoHint': 'A photo helps buyers. Preview only for now — nothing is uploaded.',
  'listingForm.photoChosen': 'Photo chosen',
  'listingForm.saveDraft': 'Save as draft',
  'listingForm.list': 'List it',
  'listingForm.save': 'Save',
  'listingForm.cancel': 'Cancel',
  'listingForm.withdraw': 'Withdraw',
  'listingForm.markSold': 'Mark as sold',
  'listingForm.relist': 'List again',
  'listingForm.pendingReason': 'Your listing will be visible once an officer has verified you.',
  'listingForm.pendingSavedDraft': 'Saved as a draft. It goes live once you are verified.',

  // Field errors (farmer-sized)
  'error.optional': 'optional',
  'error.quantity': 'Enter how many kilograms, as a number.',
  'error.crop': 'Choose a crop.',
  'error.availableFrom': 'Enter the date the produce is available.',

  // Common
  'common.optional': 'optional',
  'common.saving': 'Saving…',
  'common.yes': 'Yes',
  'common.no': 'No',
} as const;

export type TKey = keyof typeof en;
