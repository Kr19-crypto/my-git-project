import type { Role } from './types.js';

/**
 * Default role set:
 *   architect, security, tester, maintainer
 *
 * Models are placeholders. Users can override with a local roles JSON config.
 * The default model names should be replaced by the actual provider/model used
 * at runtime via env/CLI config.
 */
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'architect',
    name: '架构师',
    description: '检查改动是否破坏模块边界、架构一致性、扩展性和更大项目上下文。',
    systemPrompt:
      '你是一名资深软件架构师。请从架构、模块边界、扩展性和更大项目上下文的角度评审代码改动。' +
      '指出可能影响系统结构的问题，不要只停留在语法层面。',
    model: 'deepseek-chat',
    tier: 'core',
    maxOutputTokens: 1200,
    weight: 1.2,
  },
  {
    id: 'security',
    name: '安全工程师',
    description: '检查注入、路径穿越、权限、密钥泄露、危险 API 等安全问题。',
    systemPrompt:
      '你是一名安全工程师。请重点检查安全风险：注入、路径穿越、权限、密钥泄露、危险 API、输入校验等问题。' +
      '如果发现安全风险，请明确标记为 blocking。',
    model: 'deepseek-chat',
    tier: 'core',
    maxOutputTokens: 1200,
    weight: 1.2,
  },
  {
    id: 'tester',
    name: '测试工程师',
    description: '检查可测试性、边界条件、缺失的测试和潜在 bug。',
    systemPrompt:
      '你是一名测试工程师。请从可测试性、边界条件、潜在 bug、缺失测试用例等角度评审改动。' +
      '给出具体的测试建议。',
    model: 'deepseek-chat',
      tier: 'aux',
    maxOutputTokens: 1000,
    weight: 1.0,
  },
  {
    id: 'maintainer',
    name: '维护者/最终评审',
    description: '代表项目维护者做最终判断，汇总是否可合并、必须修改项和建议。',
    systemPrompt:
      '你是项目维护者和最终评审人。请综合前面角色的意见，输出总体结论、必须修改项、风险和建议。' +
      '你的判断将作为最终 review 结论的重要基础。',
    model: 'deepseek-chat',
      tier: 'core',
    maxOutputTokens: 1500,
    weight: 1.4,
  },
];

export function getDefaultRoles(): Role[] {
  return DEFAULT_ROLES.map((role) => ({ ...role }));
}
