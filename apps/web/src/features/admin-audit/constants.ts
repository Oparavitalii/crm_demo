// Filter option lists for the audit-log events tab. Kept out of the tab
// component so it stays comfortably under the 200-line file budget.

export const ACTION_OPTIONS = [
  // Auth
  'login',
  'login_failed',
  'logout',
  'password_reset_request',
  'password_reset_complete',
  'session_reuse_detected',
  // Candidates
  'create_candidate',
  'update_candidate',
  'delete_candidate',
  'anonymize_candidate',
  // Users
  'create_user',
  'update_user',
  'admin_password_reset',
  'force_logout',
  // Dismissals
  'create_dismissal',
  'update_dismissal',
  'delete_dismissal',
  // Message templates
  'create_message_template',
  'update_message_template',
  'delete_message_template',
  // Bulk comms
  'send_bulk_email',
];

export const ENTITY_TYPE_OPTIONS = [
  'candidate',
  'user',
  'dismissal',
  'message_template',
  'message',
];
