const editableCollections = new Set([
  'ads',
  'audit',
  'branding',
  'imports',
  'legacyTasks',
  'monitors',
  'preferences',
  'products',
  'reviews',
  'sites',
]);
export const isWorkspaceSyncKey = (key: string) =>
  editableCollections.has(key.split(':')[0]!);
