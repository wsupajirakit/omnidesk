// Map legacy display names stored on some roles → the canonical permission ids.
const NORMALIZE: Record<string, string> = {
  'Audit Logs': 'audit.manage',
  'Auto Replies': 'auto_reply.manage',
  'Broadcast': 'broadcast.manage',
  'System Config': 'config.manage',
  'Dynamic Tag Manage': 'dynamic_tags.manage',
  'Flex Manage': 'flex.manage',
  'Sector Groups': 'group.manage',
  'Channels': 'hook.manage',
  'Manage Objects': 'object.manage',
  'Roles': 'role.manage',
  'Slip Manage': 'slip.manage',
  'Users': 'user.manage',
  'Webhook Log': 'webhook_log.manage',
};

/**
 * Localized label for a permission id — the SAME mapping the create/edit user
 * modal uses (i18n key `user.permission_<id_with_underscores>`), so every place
 * that lists permissions reads identically. Falls back to the raw id when there
 * is no translation.
 */
export const permissionLabel = (
  permissionId: string,
  t: (key: string) => string
): string => {
  const normalizedId = NORMALIZE[permissionId] || permissionId;
  const key = `user.permission_${normalizedId.replace(/\./g, '_')}`;
  const translated = t(key);
  return translated === key ? permissionId : translated;
};
