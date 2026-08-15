// scripts/vendor-copy.js
// 复制已安装的 npm 前端插件到 public/ 目录，供静态引用（不用 CDN，离线可用）
// 用法：node scripts/vendor-copy.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const DEST_JS = path.join(ROOT, 'public', 'js', 'vendor');
const DEST_CSS = path.join(ROOT, 'public', 'css', 'vendor');

// 源目录 → 需要复制的文件（相对于该 npm 包根目录）
// 每个条目：{ from: 包根内相对路径, to: 目标文件（联合方式） }
const JOBS = [
  // —— Bootstrap 5（深色主题基底）——
  { from: 'bootstrap/dist/css/bootstrap.min.css', to: 'css/bootstrap.min.css', j: 'css' },
  { from: 'bootstrap/dist/js/bootstrap.bundle.min.js', to: 'js/bootstrap.bundle.min.js', j: 'js' },

  // —— 表格增强 DataTables（需 bootstrap5 样式，这里用基础样式，可再套主题）——
  { from: 'datatables.net/css/dataTables.dataTables.css', to: 'css/dataTables.css', j: 'css' },
  { from: 'datatables.net/js/dataTables.mjs', to: 'js/dataTables.mjs', j: 'js' }, // 说明：datatables.net 主入口在 js/dataTables.mjs，低版本提供 dataTables.js；若缺会报错
  // DataTables 官方也为 Bootstrap5 提供样式包，需单独装 datatables.net-bs5，这里用基础样式

  // —— bootstrap-icons（图标）——
  { from: 'bootstrap-icons/font/bootstrap-icons.css', to: 'css/bootstrap-icons.css', j: 'css' },
  { from: 'bootstrap-icons/font/fonts/*', to: 'fonts/', j: 'font' },

  // —— Select2（下拉增强）——
  { from: 'select2/dist/js/select2.min.js', to: 'js/select2.min.js', j: 'js' },
  { from: 'select2/dist/css/select2.min.css', to: 'css/select2.min.css', j: 'css' },

  // —— SweetAlert2（弹窗）——
  { from: 'sweetalert2/dist/sweetalert2.all.min.js', to: 'js/sweetalert2.all.min.js', j: 'js' },
  // 注意 sweetalert2.all 内含样式

  // —— Toastify（轻量提示）——
  { from: 'toastify-js/src/toastify.js', to: 'js/toastify.js', j: 'js' },
  { from: 'toastify-js/src/toastify.css', to: 'css/toastify.css', j: 'css' },

  // —— Animate.css（动效）——
  { from: 'animate.css/animate.min.css', to: 'css/animate.min.css', j: 'css' },

  // —— GridStack（拖拽布局，能力中心 Workflow 编排可用）——
  { from: 'gridstack/dist/gridstack.min.css', to: 'css/gridstack.min.css', j: 'css' },
  { from: 'gridstack/dist/gridstack-all.js', to: 'js/gridstack-all.js', j: 'js' },

  // —— SortableJS（拖拽排序）——
  { from: 'sortablejs/Sortable.min.js', to: 'js/Sortable.min.js', j: 'js' },

  // —— Flatpickr（日期选择）——
  { from: 'flatpickr/dist/flatpickr.min.js', to: 'js/flatpickr.min.js', j: 'js' },
  { from: 'flatpickr/dist/flatpickr.min.css', to: 'css/flatpickr.min.css', j: 'css' },
  { from: 'flatpickr/dist/l10n/zh.js', to: 'js/flatpickr-zh.js', j: 'js' },

  // —— Lucide（现代图标集）——
  { from: 'lucide/dist/umd/lucide.min.js', to: 'js/lucide.min.js', j: 'js' },

  // —— FullCalendar（日历视图）——
  { from: 'fullcalendar/index.global.min.js', to: 'js/fullcalendar.global.min.js', j: 'js' },

  // —— Prism（代码高亮，前端/文档生成可用）——
  { from: 'prismjs/prism.js', to: 'js/prism.js', j: 'js' },
  { from: 'prismjs/themes/prism-tomorrow.min.css', to: 'css/prism-tomorrow.min.css', j: 'css' },

  // —— Chart.js / ECharts（图表）——
  { from: 'chart.js/dist/chart.umd.js', to: 'js/chart.umd.js', j: 'js' },
  { from: 'echarts/dist/echarts.min.js', to: 'js/echarts.min.js', j: 'js' },

  // —— Quill（富文本编辑器，Prompt / Reference 内容编辑可用）——
  { from: 'quill/dist/quill.js', to: 'js/quill.js', j: 'js' },
  { from: 'quill/dist/quill.snow.css', to: 'css/quill.snow.css', j: 'css' },

  // —— DOMPurify（XSS 清理，展示用户/AI 内容必用）——
  { from: 'dompurify/dist/purify.min.js', to: 'js/dompurify.min.js', j: 'js' },

  // —— diff（对比算法，回答对比调试工具）——
  { from: 'diff/dist/diff.min.js', to: 'js/diff.js', j: 'js' },

  // —— js-beautify（代码格式化：beautify.js, css_beautify.js, js_beautify.js）——
  { from: 'js-beautify/js/lib/beautifier.js', to: 'js/js-beautify.js', j: 'js' },

  // —— 说明：DataTables 依赖 jQuery？—— datatables.net@3 是零依赖（不再依赖 jQuery），好
];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function copy(fromAbs, toAbs) {
  ensureDir(path.dirname(toAbs));
  fs.copyFileSync(fromAbs, toAbs);
  console.log('  ✓ ' + path.basename(toAbs));
}

let ok = 0, fail = 0;
for (const job of JOBS) {
  const fromAbs = path.join(NM, job.from);
  if (!fs.existsSync(fromAbs.replace(/\*\S*$/, '')) && !fs.globSync) {
    // 跳过 glob 特殊处理的外层；简单不存在检测
  }
  // 处理 glob 模式（例如 fonts/*）
  if (job.from.includes('*')) {
    const dir = fromAbs.slice(0, fromAbs.lastIndexOf('/'));
    const pat = path.basename(job.from);
    if (!fs.existsSync(dir)) { console.log('  ✗ 缺失源目录: ' + dir); fail++; continue; }
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(pat.replace('*', '').toLowerCase()) || pat === '*');
    for (const f of files) {
      const to = path.join(DEST_JS, job.to, f) /* fonts 放 js dir，占位; 实际 fonts 应入 css */;
      const toDir = job.j === 'font' ? path.join(DEST_CSS, 'fonts') : path.join(job.j === 'js' ? DEST_JS : DEST_CSS);
      copy(path.join(dir, f), path.join(toDir, f));
    }
    ok += files.length;
    continue;
  }
  if (!fs.existsSync(fromAbs)) { console.log('  ✗ 缺失: ' + job.from); fail++; continue; }
  const toDir = job.j === 'js' ? DEST_JS : DEST_CSS;
  copy(fromAbs, path.join(toDir, job.to.split('/').pop()));
  ok++;
}

console.log(`\n完成：成功 ${ok} 个，失败 ${fail} 个`);
console.log('JS → ' + DEST_JS);
console.log('CSS → ' + DEST_CSS);