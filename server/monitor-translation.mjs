import { translateCollectionRecords } from './collection-translation.mjs';
import { translateMachineItems } from './machine-translation.mjs';

export function translateMonitorRecords(kind, records, overrides = {}) {
  return translateCollectionRecords(kind, records, overrides.model, {
    optional: true,
    fallback: (items) => translateMachineItems(items, overrides.machine),
  });
}
