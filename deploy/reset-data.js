/**
 * 数据重置脚本
 *
 * 清空运行时数据（data/ 目录下的所有 JSON 文件），
 * 保留目录结构。适用于部署测试或需要重新开始的情况。
 *
 * 用法: node deploy/reset-data.js
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_DIR = config.paths.data;

function reset() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('  · data/ 目录不存在，无需重置');
    return;
  }

  const files = fs.readdirSync(DATA_DIR);
  let removed = 0;
  let errors = 0;

  for (const file of files) {
    const fp = path.join(DATA_DIR, file);
    // 只删除 .json 文件，保留目录和 .gitkeep
    if (file.endsWith('.json') && fs.statSync(fp).isFile()) {
      try {
        fs.unlinkSync(fp);
        console.log(`  · 删除: ${file}`);
        removed++;
      } catch (err) {
        console.error(`  · 删除失败: ${file} — ${err.message}`);
        errors++;
      }
    }
  }

  console.log('');
  console.log(`  重置完成：删除 ${removed} 个数据文件${errors ? `，${errors} 个失败` : ''}`);
  console.log('  重启服务后 data/ 目录将由种子数据重新生成');
}

reset();