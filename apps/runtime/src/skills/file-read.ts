/**
 * file-read skill
 *
 * 读取本地文件内容。默认限制大小（防止一次性读大文件炸内存），
 * 且强制要求绝对路径或受信任的工作目录。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Skill } from './types.js';

const DEFAULT_MAX_BYTES = 256 * 1024; // 256KB
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';

export interface FileReadOptions {
  /** 允许访问的根目录（白名单），不设置则不限制 */
  allowedRoots?: string[];
  /** 最大可读取字节数 */
  maxBytes?: number;
  /** 文件编码 */
  encoding?: BufferEncoding;
}

export function createFileReadSkill(options: FileReadOptions = {}): Skill {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const encoding = options.encoding ?? DEFAULT_ENCODING;
  const allowedRoots = options.allowedRoots;

  return {
    name: 'file_read',
    description: '读取本地文本文件的内容（受大小和路径白名单限制）。',
    enabledByDefault: false,
    instructions: `当用户提供文件路径并要求查看内容时，使用 file_read。
请用如下格式调用：
<skill>{"name":"file_read","args":{"path":"<绝对路径>","maxBytes":<可选字节上限>}}</skill>`,
    parameters: [
      { name: 'path', type: 'string', description: '文件绝对路径', required: true },
      { name: 'maxBytes', type: 'number', description: '可选，本次最大读取字节数', required: false },
    ],
    execute: async (args) => {
      const rawPath = String(args.path ?? '').trim();
      if (!rawPath) {
        throw new Error('file_read: path 不能为空');
      }
      const abs = path.resolve(rawPath);

      // 路径白名单
      if (allowedRoots && allowedRoots.length > 0) {
        const ok = allowedRoots.some((root) => {
          const r = path.resolve(root);
          return abs === r || abs.startsWith(r + path.sep);
        });
        if (!ok) {
          throw new Error(
            `file_read: 路径 "${abs}" 不在白名单内（允许: ${allowedRoots.join(', ')}）`
          );
        }
      }

      const limit = Math.min(
        Number(args.maxBytes) > 0 ? Number(args.maxBytes) : maxBytes,
        maxBytes
      );

      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        throw new Error(`file_read: "${abs}" 不是普通文件`);
      }
      if (stat.size > limit) {
        throw new Error(
          `file_read: 文件大小 ${stat.size}B 超过上限 ${limit}B（请加大 maxBytes 或分段读取）`
        );
      }
      const content = await fs.readFile(abs, { encoding });
      return { path: abs, size: stat.size, content };
    },
  };
}

/** 默认实例：仅做大小限制，不限制路径（仅供 demo，生产请用 createFileReadSkill({ allowedRoots })） */
export const fileReadSkill: Skill = createFileReadSkill();
