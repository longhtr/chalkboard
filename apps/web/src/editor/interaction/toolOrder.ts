/** Loads toolbar order only after removing unknown and duplicate persisted identifiers. */
import { bestEffortLocalStorage } from '../../bestEffortStorage';
import { DEFAULT_TOOL_ORDER, type Tool } from './toolModel';

/** Disposable preference key for the stable sequence of tool identifiers. */
export const LOCAL_TOOL_ORDER_KEY = 'chalkboard:tool-order';

function isTool(value: unknown): value is Tool {
  return (
    typeof value === 'string' &&
    DEFAULT_TOOL_ORDER.some((tool) => tool === value)
  );
}

/** Removes unknown/duplicate tools and appends every missing supported tool. */
export function normalizeToolOrder(value: unknown): Tool[] {
  if (!Array.isArray(value)) return [...DEFAULT_TOOL_ORDER];
  const supported = value.filter(
    (entry, index): entry is Tool =>
      isTool(entry) && value.indexOf(entry) === index,
  );
  return [
    ...supported,
    ...DEFAULT_TOOL_ORDER.filter((tool) => !supported.includes(tool)),
  ];
}

/** Reads and repairs toolbar order, falling back after malformed storage. */
export function loadToolOrder(): Tool[] {
  try {
    return normalizeToolOrder(
      JSON.parse(
        bestEffortLocalStorage.getItem(LOCAL_TOOL_ORDER_KEY) ?? 'null',
      ),
    );
  } catch {
    return [...DEFAULT_TOOL_ORDER];
  }
}
