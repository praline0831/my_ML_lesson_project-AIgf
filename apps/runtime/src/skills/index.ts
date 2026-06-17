/**
 * Skills 模块统一导出
 */

export { SkillsManager } from './manager.js';
export type { Skill, SkillContext, SkillParameter } from './types.js';

export { webSearchSkill } from './web-search.js';
export { calculatorSkill } from './calculator.js';
export { createFileReadSkill, fileReadSkill } from './file-read.js';
export type { FileReadOptions } from './file-read.js';

import { webSearchSkill } from './web-search.js';
import { calculatorSkill } from './calculator.js';
import { fileReadSkill } from './file-read.js';

/** tools.yaml 中声明的 3 个内置 skill 集合 */
export const builtinSkills = [webSearchSkill, calculatorSkill, fileReadSkill];
