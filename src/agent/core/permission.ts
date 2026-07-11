// Permission system (P2.4): classify actions into safety levels.
export enum PermissionLevel {
  SAFE = 'SAFE',
  RESTRICTED = 'RESTRICTED',
  DANGER = 'DANGER',
}

export interface PermissionRule {
  pattern: RegExp;
  level: PermissionLevel;
  humanConfirm?: boolean;
}

// Default rules. Out-of-project paths and destructive ops are DANGER; network/install RESTRICTED.
const DEFAULT_RULES: PermissionRule[] = [
  { pattern: /^out-of-project:.*$/, level: PermissionLevel.DANGER },
  { pattern: /^(rm|del|format|mkfs|shutdown|reboot)\b/i, level: PermissionLevel.DANGER },
  { pattern: /\b(rm\s+-rf|rmdir|deltree)\b/i, level: PermissionLevel.DANGER },
  { pattern: /^(npm|pnpm|yarn)\s+(i|install|add|remove|uninstall)\b/i, level: PermissionLevel.RESTRICTED },
  { pattern: /\b(curl|wget|git\s+push|ssh|scp|ftp)\b/i, level: PermissionLevel.RESTRICTED },
  { pattern: /^network:(search|fetch)$/, level: PermissionLevel.RESTRICTED },
];

export function classify(action: string): PermissionLevel {
  for (const rule of DEFAULT_RULES) {
    if (rule.pattern.test(action)) return rule.level;
  }
  return PermissionLevel.SAFE;
}

export function isAllowed(level: PermissionLevel, confirmed = false): boolean {
  if (level === PermissionLevel.SAFE) return true;
  if (level === PermissionLevel.RESTRICTED) return confirmed; // needs human confirm in real deploy
  return false; // DANGER blocked by default in MVP
}
