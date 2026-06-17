/**
 * SkillsManager - 负责 Skill 的注册、激活、指令注入与调用
 *
 * 用法：
 *   const mgr = new SkillsManager();
 *   mgr.register(calculatorSkill);
 *   mgr.activate('calculator');
 *
 *   // 给 Agent 用：
 *   const systemPrompt = mgr.buildSystemPrompt();
 *   // 或直接调用 skill：
 *   const result = await mgr.invoke('calculator', { expression: '1+1' }, ctx);
 */

import { Skill, SkillContext, SkillParameter } from './types.js';

export class SkillsManager {
  private skills: Map<string, Skill> = new Map();
  private active: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();

  /** 注册一个 Skill（同名将覆盖） */
  public register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    if (skill.enabledByDefault) {
      this.active.add(skill.name);
    }
    this.emit();
  }

  /** 注销 */
  public unregister(name: string): boolean {
    const ok = this.skills.delete(name);
    this.active.delete(name);
    if (ok) this.emit();
    return ok;
  }

  /** 激活一个 Skill（让它的 instructions 注入到 system prompt） */
  public activate(name: string): void {
    if (!this.skills.has(name)) {
      throw new Error(`Skill "${name}" 未注册`);
    }
    this.active.add(name);
    this.emit();
  }

  /** 停用一个 Skill */
  public deactivate(name: string): void {
    this.active.delete(name);
    this.emit();
  }

  /** 批量设置激活列表 */
  public setActive(names: string[]): void {
    this.active.clear();
    for (const n of names) {
      if (!this.skills.has(n)) {
        throw new Error(`Skill "${n}" 未注册`);
      }
      this.active.add(n);
    }
    this.emit();
  }

  /** 切换激活状态 */
  public toggle(name: string): boolean {
    if (this.active.has(name)) {
      this.deactivate(name);
      return false;
    }
    this.activate(name);
    return true;
  }

  public get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  public getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  public getActive(): Skill[] {
    return Array.from(this.active)
      .map((n) => this.skills.get(n))
      .filter((s): s is Skill => !!s);
  }

  public isActive(name: string): boolean {
    return this.active.has(name);
  }

  /**
   * 生成供 LLM 使用的"可用 Skill 列表"提示片段
   *
   * 包含每个 skill 的 name / description / parameters。
   * 与 buildSystemPrompt() 的区别：本函数只生成可用 skill 清单，
   * 便于在 LLM 需要"自主决定调用哪个 skill"时附加。
   */
  public buildCatalog(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = ['【可用 Skills】'];
    for (const s of this.skills.values()) {
      lines.push(`- ${s.name}: ${s.description}`);
      if (s.parameters && s.parameters.length > 0) {
        const paramsDesc = s.parameters
          .map((p) => `${p.name}${p.required ? '*' : ''}(${p.type}): ${p.description}`)
          .join(', ');
        lines.push(`    参数: ${paramsDesc}`);
      }
    }
    lines.push('');
    lines.push(
      '如需调用 skill，请输出：<skill>{"name":"<skill_name>","args":{...}}</skill>'
    );
    return lines.join('\n');
  }

  /**
   * 根据当前激活的 skill，生成追加到 system prompt 的指令片段
   */
  public buildSystemPrompt(): string {
    const active = this.getActive();
    if (active.length === 0) return '';
    const lines: string[] = ['【已激活的 Skills】'];
    for (const s of active) {
      lines.push(`### ${s.name}`);
      lines.push(s.description);
      if (s.parameters && s.parameters.length > 0) {
        lines.push(this.formatParameters(s.parameters));
      }
      if (s.instructions) {
        lines.push('');
        lines.push(s.instructions);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  private formatParameters(params: SkillParameter[]): string {
    return params
      .map((p) => `  - ${p.name}${p.required ? ' (必填)' : ''} [${p.type}]: ${p.description}`)
      .join('\n');
  }

  /**
   * 调用指定 skill
   *
   * - skill 必须已注册
   * - skill 必须有 execute 入口，否则抛错
   */
  public async invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: SkillContext
  ): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" 未注册`);
    }
    if (!skill.execute) {
      throw new Error(`Skill "${name}" 不提供 execute 入口，仅作为指令包`);
    }
    return await skill.execute(args, ctx);
  }

  /**
   * 解析 LLM 输出中的 <skill>...</skill> 标签
   * 返回第一个匹配项（与 parseToolCall 保持一致）
   */
  public parseSkillCall(
    response: string
  ): { name: string; args: Record<string, unknown> } | null {
    const match = response.match(/<skill>([\s\S]*?)<\/skill>/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { name, args } = parsed as { name?: unknown; args?: unknown };
      if (typeof name !== 'string') return null;
      return {
        name,
        args: (typeof args === 'object' && args !== null
          ? (args as Record<string, unknown>)
          : {}),
      };
    } catch {
      return null;
    }
  }

  /** 订阅激活状态变化（返回取消订阅函数） */
  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
