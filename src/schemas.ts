import { z } from 'zod';
import {
  RecencyFilter,
  TaskComplexity,
  TaskType,
  type RouterConfig,
  type TaskDescriptor,
} from './types.js';

export const TaskDescriptorSchema = z.object({
  type: z.nativeEnum(TaskType),
  complexity: z.nativeEnum(TaskComplexity),
  expectedOutputTokens: z.number().int().positive().optional(),
  requiresReasoning: z.boolean().optional(),
  requiresSearch: z.boolean().optional(),
  recency: z.nativeEnum(RecencyFilter).optional(),
  domainFilter: z.array(z.string().min(1)).optional(),
  images: z.array(z.string().min(1)).optional(),
  viewport: z.enum(['desktop', 'mobile']).optional(),
  clientId: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const ExecutableTaskDescriptorSchema = TaskDescriptorSchema.extend({
  clientId: z.string().min(1, 'clientId is required for budget tracking'),
});
export type ExecutableTaskDescriptor = z.infer<typeof ExecutableTaskDescriptorSchema>;

const BudgetConfigPartialSchema = z.object({
  monthlyBudgetPerClient: z.number().positive(),
  weeklyTarget: z.number().positive(),
  weeklyHardCeiling: z.number().positive(),
  globalMonthlyHardCeiling: z.number().positive(),
  surgeThreshold: z.number().min(0).max(1),
}).partial();

const CircuitBreakerConfigPartialSchema = z.object({
  failureThreshold: z.number().int().positive(),
  openDurationMs: z.number().int().positive(),
}).partial();

export const RouterConfigSchema = z.object({
  perplexityApiKey: z.string().min(1, 'perplexityApiKey is required'),
  openrouterApiKey: z.string().min(1, 'openrouterApiKey is required'),
  openrouterBaseUrl: z.string().url('openrouterBaseUrl must be an absolute URL').refine(
    value => value.startsWith('https://') || value.startsWith('http://'),
    { message: 'openrouterBaseUrl must use http(s)' },
  ).optional(),
  appName: z.string().min(1).optional(),
  budget: BudgetConfigPartialSchema.optional(),
  circuitBreaker: CircuitBreakerConfigPartialSchema.optional(),
  providerTimeoutMs: z.number().int().positive().optional(),
  providerMaxRetries: z.number().int().refine(value => value === 0, {
    message: 'providerMaxRetries must remain 0 so attempts stay explicit',
  }).optional(),
});

interface PublicIssue { path: Array<string | number>; message: string; code: string }
function publicIssues(error: z.ZodError): PublicIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.map(segment => typeof segment === 'symbol' ? String(segment) : segment),
    message: issue.message,
    code: issue.code,
  }));
}

export class TaskValidationError extends Error {
  constructor(message: string, public readonly issues: PublicIssue[]) { super(message); this.name = 'TaskValidationError'; }
  toJSON(): Record<string, unknown> { return { name: this.name, message: this.message, issues: this.issues }; }
}

export class RouterConfigValidationError extends Error {
  constructor(message: string, public readonly issues: PublicIssue[]) { super(message); this.name = 'RouterConfigValidationError'; }
  toJSON(): Record<string, unknown> { return { name: this.name, message: this.message, issues: this.issues }; }
}

function parseTaskWithSchema<T>(schema: z.ZodType<T>, task: unknown): T {
  const result = schema.safeParse(task);
  if (!result.success) {
    const issues = publicIssues(result.error);
    throw new TaskValidationError(`Invalid TaskDescriptor: ${issues.map(issue => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')}`, issues);
  }
  return result.data;
}

export function parseTaskDescriptor(task: unknown): TaskDescriptor {
  return parseTaskWithSchema(TaskDescriptorSchema, task) as TaskDescriptor;
}

export function parseExecutableTaskDescriptor(task: unknown): ExecutableTaskDescriptor {
  return parseTaskWithSchema(ExecutableTaskDescriptorSchema, task);
}

export function parseRouterConfig(config: unknown): RouterConfig {
  const result = RouterConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = publicIssues(result.error);
    throw new RouterConfigValidationError(`Invalid RouterConfig: ${issues.map(issue => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')}`, issues);
  }
  return result.data as RouterConfig;
}
