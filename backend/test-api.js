/**
 * API 测试脚本
 *
 * 测试提示词助理的 4 种模式
 */

import dotenv from 'dotenv';
dotenv.config();

import grokClient from './src/services/grokClient.js';
import { SYSTEM_PROMPTS } from './src/config/systemPrompts.js';
import { VARIATION_SCHEMA } from './src/schemas/variationSchema.js';
import { SCRIPT_SCHEMA } from './src/schemas/scriptSchema.js';

console.log('='.repeat(60));
console.log('提示词助理 API 测试');
console.log('='.repeat(60));
console.log();

// 测试用例
const testCases = [
  {
    mode: 'variation',
    name: '创建变体模式',
    input: 'a girl, #wearing red dress@0.8(prefer blue tones), standing in the garden',
    schema: VARIATION_SCHEMA
  },
  {
    mode: 'polish',
    name: '扩写润色模式',
    input: 'a girl, [wearing dress......], standing in the [garden..]',
    schema: null
  },
  {
    mode: 'continue',
    name: '脑补后续模式',
    input: 'a young woman in a white dress, standing alone in a misty forest at dawn, holding a glowing lantern',
    schema: null
  },
  {
    mode: 'script',
    name: '生成剧本模式',
    input: '一个少女在森林中迷路，遇到了一只会说话的狐狸，狐狸带她找到了回家的路。请生成 4 个分镜。',
    schema: SCRIPT_SCHEMA
  }
];

// 测试函数
async function testMode(testCase) {
  console.log(`\n📝 测试 ${testCase.mode} - ${testCase.name}`);
  console.log('-'.repeat(60));
  console.log(`输入: ${testCase.input.substring(0, 80)}${testCase.input.length > 80 ? '...' : ''}`);
  console.log();

  try {
    const systemPrompt = SYSTEM_PROMPTS[testCase.mode];
    const options = {
      temperature: testCase.mode === 'variation' ? 1.2 : (testCase.mode === 'polish' ? 0.8 : 1.0)
    };

    if (testCase.schema) {
      options.response_format = testCase.schema;
    }

    const startTime = Date.now();
    const response = await grokClient.generate(systemPrompt, testCase.input, options);
    const duration = Date.now() - startTime;

    console.log(`✅ 生成成功 (耗时: ${duration}ms)`);
    console.log();

    // 解析响应
    if (testCase.schema) {
      try {
        const parsed = JSON.parse(response);
        if (testCase.mode === 'variation') {
          console.log(`生成了 ${parsed.variations.length} 个变体:`);
          parsed.variations.forEach((v, i) => {
            console.log(`\n  ${i + 1}. ${v.prompt.substring(0, 100)}${v.prompt.length > 100 ? '...' : ''}`);
          });
        } else if (testCase.mode === 'script') {
          console.log(`生成了 ${parsed.shots.length} 个分镜:`);
          parsed.shots.forEach((shot) => {
            console.log(`\n  分镜 ${shot.shot_number}: ${shot.prompt.substring(0, 100)}${shot.prompt.length > 100 ? '...' : ''}`);
          });
        }
      } catch (parseError) {
        console.error('❌ JSON 解析失败:', parseError.message);
        console.log('原始响应:', response.substring(0, 200));
      }
    } else {
      console.log(`生成结果:\n${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);
    }

    return true;
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    return false;
  }
}

// 运行所有测试
async function runAllTests() {
  let successCount = 0;
  let failCount = 0;

  for (const testCase of testCases) {
    const success = await testMode(testCase);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // 等待 1 秒避免频率限制
    if (testCase !== testCases[testCases.length - 1]) {
      console.log('\n⏳ 等待 1 秒...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`测试完成: ${successCount} 成功, ${failCount} 失败`);
  console.log('='.repeat(60));
}

// 执行测试
runAllTests().catch(error => {
  console.error('测试脚本错误:', error);
  process.exit(1);
});
