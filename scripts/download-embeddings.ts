import { execSync } from 'child_process';

console.log('🚀 下载本地 Embeddings 模型（nomic-embed-text）...');

try {
  // 检查 Ollama 是否运行
  execSync('curl http://localhost:11434/api/tags', { stdio: 'pipe' });

  // 检查模型是否存在
  const models = JSON.parse(execSync('curl -s http://localhost:11434/api/tags').toString());
  const hasModel = models.models.some((m: any) => m.name === 'nomic-embed-text');

  if (!hasModel) {
    console.log('📦 下载模型 nomic-embed-text（约 45MB）...');
    execSync('ollama pull nomic-embed-text', { stdio: 'inherit' });
  } else {
    console.log('✅ 模型已存在');
  }

  console.log('✅ 下载完成！');
} catch (error) {
  console.error('❌ 错误:', error);
  console.log('\n💡 提示:');
  console.log('1. 请先运行 `ollama serve`');
  console.log('2. 或手动下载: ollama pull nomic-embed-text');
}