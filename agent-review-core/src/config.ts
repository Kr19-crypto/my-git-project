import { readFile } from 'node:fs/promises';
import type { Role, RoundtableConfig } from './types.js';
import { getDefaultRoles } from './defaultRoles.js';

export interface CliOptions {
  repo?: string;
  diffFile?: string;
  path?: string;
  task?: string;
  rounds: number;
  budgetLimitTokens: number;
  mock: boolean;
  yes: boolean;
  rolesConfig?: string;
}

export async function loadRoles(rolesConfig?: string): Promise<Role[]> {
  if (!rolesConfig) return getDefaultRoles();
  const raw = await readFile(rolesConfig, 'utf8');
  const parsed = JSON.parse(raw) as { roles?: Role[] };
  if (!parsed.roles || parsed.roles.length === 0) {
    throw new Error('roles config must contain a non-empty "roles" array');
  }
  return parsed.roles;
}

/**
 * Apply environment-based role model routing.
 *
 * Supported env vars:
 *   LLM_CORE_MODEL               -> all roles with tier 'core'
 *   LLM_AUX_MODEL                -> all roles with tier 'aux'
 *   LLM_ROLE_<ROLE_ID>_MODEL     -> per-role model override, highest priority
 *   LLM_ROLE_<ROLE_ID>_BASE_URL  -> per-role provider base URL override
 */
export function applyRoleModelRouting(roles: Role[]): Role[] {
  const coreModel = process.env.LLM_CORE_MODEL;
  const auxModel = process.env.LLM_AUX_MODEL;

  return roles.map((role) => {
    const roleModelEnv = process.env[`LLM_ROLE_${role.id.toUpperCase()}_MODEL`];
    const roleBaseUrlEnv = process.env[`LLM_ROLE_${role.id.toUpperCase()}_BASE_URL`];
    const model = roleModelEnv ?? (role.tier === 'core' && coreModel ? coreModel : role.tier === 'aux' && auxModel ? auxModel : role.model);
    if (model !== role.model || roleBaseUrlEnv) {
      return { ...role, model, ...(roleBaseUrlEnv ? { baseUrl: roleBaseUrlEnv } : {}) };
    }
    return role;
  });
}


export function createConfig(
  options: CliOptions,
  roles: Role[],
): RoundtableConfig {
  return {
    roles,
    rounds: options.rounds,
    budgetLimitTokens: options.budgetLimitTokens,
      summaryReserveTokens: 8000,
    mock: options.mock,
  };
}
