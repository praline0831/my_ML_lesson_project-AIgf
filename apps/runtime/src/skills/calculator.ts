/**
 * calculator skill
 *
 * 安全的算术表达式求值。仅支持数字 + - * / ( ) 和小数点，
 * 使用 Function 构造器而非 eval（更可控、更易扩展）。
 */

import { Skill } from './types.js';

function safeEval(expr: string): number {
  // 严格白名单：数字、空格、四则、括号、小数点
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
    throw new Error('表达式包含非法字符（仅支持 0-9 + - * / ( ) . 空格）');
  }
  // 阻止连续两个运算符（防止函数调用/原型链攻击）
  if (/[+\-*/.][+\-*/.]{1,}/.test(expr.replace(/\s+/g, ''))) {
    throw new Error('表达式包含不合法序列');
  }
  // 用 Function 隔离作用域
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${expr});`);
  const result = fn();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('表达式结果不是有限数');
  }
  return result;
}

export const calculatorSkill: Skill = {
  name: 'calculator',
  description: '执行数学计算。支持四则运算、括号、小数。',
  enabledByDefault: true,
  instructions: `当用户提出数学计算请求时，优先使用 calculator。
请用如下格式调用：
<skill>{"name":"calculator","args":{"expression":"<算式>"}}</skill>`,
  parameters: [
    { name: 'expression', type: 'string', description: '算式，如 "(3+5)*2"', required: true },
  ],
  execute: async (args) => {
    const expression = String(args.expression ?? '').trim();
    if (!expression) {
      throw new Error('calculator: expression 不能为空');
    }
    const result = safeEval(expression);
    return { expression, result };
  },
};
