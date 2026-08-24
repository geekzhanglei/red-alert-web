import { defineConfig } from 'vite';

export default defineConfig({
  // 原始美术文件保留在仓库中供后续再加工，生产包只包含由源码实际引用的优化资源。
  publicDir: false,
});
