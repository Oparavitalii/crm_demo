// Drizzle schema — re-export all tables + relations + types
// from per-domain files in ./tables/.

export * from './enums';
export * from './tables/users';
export * from './tables/consents';
export * from './tables/consent-optin-tokens';
export * from './tables/freelancers';
export * from './tables/candidates';
export * from './tables/candidate-comments';
export * from './tables/employment-periods';
export * from './tables/dismissals';
export * from './tables/employer-inquiries';
export * from './tables/messages';
export * from './tables/audit-log';
export * from './tables/invitations';
export * from './tables/duplicate-ignores';
export * from './tables/documents';
export * from './tables/document-acceptances';
export * from './tables/projects';
export * from './tables/tasks';
export * from './tables/status-lookups';
