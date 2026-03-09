// 类型定义：Agent 系统的核心数据结构
/**
 * 消息类型枚举
 */
export var MessageType;
(function (MessageType) {
    MessageType["Human"] = "human";
    MessageType["AI"] = "ai";
    MessageType["Tool"] = "tool";
    MessageType["ToolResult"] = "tool_result";
})(MessageType || (MessageType = {}));
//# sourceMappingURL=types.js.map