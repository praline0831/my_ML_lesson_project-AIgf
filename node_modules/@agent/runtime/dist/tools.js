/**
 * 创建工具的辅助函数
 */
export function createTool(name, description, execute) {
    return { name, description, execute };
}
/**
 * 示例工具：EchoTool（调试用）
 */
export const echoTool = createTool('echo', '回显用户输入的文本（调试用）', async ({ text }) => {
    return `Echo: ${text}`;
});
/**
 * 示例工具：计算器（演示基础功能）
 */
export const calculatorTool = createTool('calculator', '执行简单数学运算（支持 + - * /）', async (args) => {
    const expression = args.expression;
    if (!/^[0-9+\-*/.\s()]+$/.test(expression)) {
        throw new Error('表达式包含非法字符');
    }
    try {
        return eval(expression);
    }
    catch {
        throw new Error('无效的表达式');
    }
});
//# sourceMappingURL=tools.js.map