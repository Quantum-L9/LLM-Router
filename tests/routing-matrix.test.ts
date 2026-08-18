import { describe, expect, it } from 'vitest';
import {
  Provider,
  RecencyFilter,
  SearchPolicySource,
  SonarModel,
  TaskComplexity,
  TaskType,
  type GeneralModel,
  type TaskDescriptor,
} from '../src/types.js';
import { L9LLMRouter, resolveRoute, UnsupportedCapabilityCombinationError, type CapabilityConflictCode } from '../src/index.js';
import { resolveGeneralConfig } from '../src/matrices/general-matrix.js';
import { resolveVisionConfig } from '../src/vision/index.js';

/**
 * Route planes are distinguished by provider *and* by which resolver owns the
 * model, because the vision plane and the general plane share Provider.OPENROUTER.
 */
type Plane = 'SEARCH' | 'NON_SEARCH' | 'VISION' | 'FAIL_CLOSED';

const IMAGES = ['https://cdn.example.com/shot.png'];

interface MatrixCase {
  id: string;
  task: TaskDescriptor;
  expected: Plane;
  expectedSource: SearchPolicySource;
  /** Required for FAIL_CLOSED rows: the exact machine-readable conflict code. */
  expectedCode?: CapabilityConflictCode;
}

const task = (over: Partial<TaskDescriptor> & Pick<TaskDescriptor, 'type'>): TaskDescriptor => ({
  complexity: TaskComplexity.MEDIUM,
  clientId: 'matrix-client',
  ...over,
});

const MATRIX: MatrixCase[] = [
  { id: 'A  STRATEGIC_REASONING       requiresSearch=false', task: task({ type: TaskType.STRATEGIC_REASONING, requiresSearch: false }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'B  STRATEGIC_REASONING       requiresSearch=true', task: task({ type: TaskType.STRATEGIC_REASONING, requiresSearch: true }), expected: 'SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'C  STRATEGIC_REASONING       requiresSearch=undefined', task: task({ type: TaskType.STRATEGIC_REASONING }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.TASK_DEFAULT },
  { id: 'D  COMPETITOR_RESEARCH       requiresSearch=true', task: task({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: true }), expected: 'SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'E  COMPETITOR_RESEARCH       requiresSearch=false', task: task({ type: TaskType.COMPETITOR_RESEARCH, requiresSearch: false }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'F  COMPETITOR_RESEARCH       requiresSearch=undefined', task: task({ type: TaskType.COMPETITOR_RESEARCH }), expected: 'SEARCH', expectedSource: SearchPolicySource.TASK_DEFAULT },
  { id: 'G  FACT_VERIFICATION         requiresSearch=false', task: task({ type: TaskType.FACT_VERIFICATION, requiresSearch: false }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'H  FACT_VERIFICATION         requiresSearch=undefined', task: task({ type: TaskType.FACT_VERIFICATION }), expected: 'SEARCH', expectedSource: SearchPolicySource.TASK_DEFAULT },
  { id: 'I  CONTENT_GENERATION        requiresSearch=false', task: task({ type: TaskType.CONTENT_GENERATION, requiresSearch: false }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'J  CONTENT_GENERATION        requiresSearch=true', task: task({ type: TaskType.CONTENT_GENERATION, requiresSearch: true }), expected: 'SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'K  SCREENSHOT_ANALYSIS+imgs  requiresSearch=false', task: task({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES, requiresSearch: false }), expected: 'VISION', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'L  SCREENSHOT_ANALYSIS+imgs  requiresSearch=undefined', task: task({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES }), expected: 'VISION', expectedSource: SearchPolicySource.TASK_DEFAULT },
  { id: 'M  SCREENSHOT_ANALYSIS+imgs  requiresSearch=true', task: task({ type: TaskType.SCREENSHOT_ANALYSIS, images: IMAGES, requiresSearch: true }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.EXPLICIT, expectedCode: 'UNSUPPORTED_CAPABILITY_COMBINATION' },
  // Capability-integrity rows from the contract: combinations the execution
  // plane cannot honor must fail closed with a machine-readable code.
  { id: 'R  SCREENSHOT_ANALYSIS        images=[]', task: task({ type: TaskType.SCREENSHOT_ANALYSIS, images: [] }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.TASK_DEFAULT, expectedCode: 'VISION_INPUT_REQUIRED' },
  { id: 'S  SCREENSHOT_ANALYSIS        images=undefined', task: task({ type: TaskType.SCREENSHOT_ANALYSIS }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.TASK_DEFAULT, expectedCode: 'VISION_INPUT_REQUIRED' },
  { id: 'T  CONTENT_GENERATION        images=[image]', task: task({ type: TaskType.CONTENT_GENERATION, images: IMAGES }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.TASK_DEFAULT, expectedCode: 'IMAGES_NOT_SUPPORTED_FOR_TASK' },
  { id: 'U  STRATEGIC_REASONING       requiresSearch=false + domainFilter', task: task({ type: TaskType.STRATEGIC_REASONING, requiresSearch: false, domainFilter: ['example.com'] }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.EXPLICIT, expectedCode: 'SEARCH_MODIFIER_WITHOUT_SEARCH' },
  { id: 'V  STRATEGIC_REASONING       requiresSearch=undefined + recency', task: task({ type: TaskType.STRATEGIC_REASONING, recency: RecencyFilter.WEEK }), expected: 'FAIL_CLOSED', expectedSource: SearchPolicySource.TASK_DEFAULT, expectedCode: 'SEARCH_MODIFIER_WITHOUT_SEARCH' },
  // Extra coverage required by §5: explicit true lifts otherwise-general task types.
  { id: 'N  EXTRACTION                requiresSearch=true', task: task({ type: TaskType.EXTRACTION, requiresSearch: true }), expected: 'SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'O  CLASSIFICATION            requiresSearch=true', task: task({ type: TaskType.CLASSIFICATION, requiresSearch: true }), expected: 'SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'P  MARKET_RESEARCH           requiresSearch=false', task: task({ type: TaskType.MARKET_RESEARCH, requiresSearch: false }), expected: 'NON_SEARCH', expectedSource: SearchPolicySource.EXPLICIT },
  { id: 'Q  MARKET_RESEARCH           requiresSearch=undefined', task: task({ type: TaskType.MARKET_RESEARCH }), expected: 'SEARCH', expectedSource: SearchPolicySource.TASK_DEFAULT },
];

function planeOf(descriptor: TaskDescriptor): Plane {
  const decision = resolveRoute(descriptor);
  if (decision.provider === Provider.PERPLEXITY) {
    expect(Object.values(SonarModel)).toContain(decision.model);
    return 'SEARCH';
  }
  const vision = VISION_TYPES.has(descriptor.type)
    ? resolveVisionConfig(
        descriptor.type as TaskType.VISUAL_QA | TaskType.SCREENSHOT_ANALYSIS | TaskType.LAYOUT_VALIDATION,
        descriptor.complexity,
        descriptor.images?.length ?? 1,
      )
    : undefined;
  if (vision && decision.model === vision.model && decision.estimatedCost === vision.estimatedCostPerCall) return 'VISION';
  const general = resolveGeneralConfig(descriptor);
  expect(decision.model).toBe<GeneralModel>(general.model);
  return 'NON_SEARCH';
}

const VISION_TYPES = new Set<TaskType>([TaskType.VISUAL_QA, TaskType.SCREENSHOT_ANALYSIS, TaskType.LAYOUT_VALIDATION]);

describe('§16 routing matrix — explicit requiresSearch is authoritative', () => {
  it.each(MATRIX)('$id -> $expected', ({ task: descriptor, expected, expectedCode }) => {
    if (expected === 'FAIL_CLOSED') {
      const failed = (() => {
        try {
          resolveRoute(descriptor);
          return undefined;
        } catch (error) {
          return error as UnsupportedCapabilityCombinationError;
        }
      })();
      expect(failed, 'expected a fail-closed throw').toBeInstanceOf(UnsupportedCapabilityCombinationError);
      expect(failed?.code).toBe(expectedCode);
      return;
    }
    expect(planeOf(descriptor)).toBe(expected);
  });

  it('resolves every matrix case identically through the public router', () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { idFactory: () => 'id', clock: () => new Date('2026-01-01T00:00:00Z') });
    for (const entry of MATRIX) {
      if (entry.expected === 'FAIL_CLOSED') {
        expect(() => router.route(entry.task), entry.id).toThrow(UnsupportedCapabilityCombinationError);
        continue;
      }
      const viaRouter = router.route(entry.task);
      const direct = resolveRoute(entry.task);
      expect({ provider: viaRouter.provider, model: viaRouter.model }, entry.id).toEqual({ provider: direct.provider, model: direct.model });
    }
  });
});

describe('§17 routing audit — searchRequired and searchPolicySource', () => {
  it.each(MATRIX.filter(entry => entry.expected !== 'FAIL_CLOSED'))(
    '$id exposes provable search-policy evidence',
    ({ task: descriptor, expected, expectedSource }) => {
      const decision = resolveRoute(descriptor);
      expect(decision.searchPolicySource).toBe(expectedSource);
      expect(decision.searchRequired).toBe(expected === 'SEARCH');
      // The audited flag must never disagree with the plane actually selected.
      expect(decision.searchRequired).toBe(decision.provider === Provider.PERPLEXITY);
    },
  );

  it('carries the audit through the full RoutingDecision surface', () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'p', openrouterApiKey: 'o' }, { idFactory: () => 'task-1', clock: () => new Date('2026-01-01T00:00:00Z') });
    const explicitFalse = router.route(task({ type: TaskType.MARKET_RESEARCH, requiresSearch: false }));
    expect(explicitFalse).toMatchObject({
      taskId: 'task-1',
      clientId: 'matrix-client',
      timestamp: '2026-01-01T00:00:00.000Z',
      taskType: TaskType.MARKET_RESEARCH,
      complexity: TaskComplexity.MEDIUM,
      provider: Provider.OPENROUTER,
      searchRequired: false,
      searchPolicySource: SearchPolicySource.EXPLICIT,
    });
    expect(typeof explicitFalse.reason).toBe('string');
    expect(explicitFalse.estimatedCost).toBeGreaterThan(0);

    const explicitTrue = router.route(task({ type: TaskType.STRATEGIC_REASONING, requiresSearch: true }));
    expect(explicitTrue).toMatchObject({ provider: Provider.PERPLEXITY, searchRequired: true, searchPolicySource: SearchPolicySource.EXPLICIT });

    const omitted = router.route(task({ type: TaskType.COMPETITOR_RESEARCH }));
    expect(omitted).toMatchObject({ provider: Provider.PERPLEXITY, searchRequired: true, searchPolicySource: SearchPolicySource.TASK_DEFAULT });
  });

  it('never leaks credentials or prompts into the routing audit', () => {
    const router = new L9LLMRouter({ perplexityApiKey: 'pplx-secret', openrouterApiKey: 'or-secret' }, { idFactory: () => 'id' });
    const serialized = JSON.stringify(router.route(task({ type: TaskType.FACT_VERIFICATION })));
    expect(serialized).not.toContain('pplx-secret');
    expect(serialized).not.toContain('or-secret');
  });
});
