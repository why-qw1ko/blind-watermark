# 盲水印工具

基于 [blind_watermark](https://github.com/guofei9987/blind_watermark) 的盲水印工具集，支持在图片中嵌入不可见水印并提取验证。

## 项目结构

本仓库包含两个独立项目：

### blind-watermark-web

Web 版盲水印工具，基于 Flask + 原生 HTML/CSS/JS。

- 嵌入水印：上传图片 → 输入文字 → 生成带水印的图片
- 提取水印：上传带水印的图片 → 输入水印长度 → 提取原始文字
- 支持图片压缩（宽高限制 1024px）
- 支持密码保护
- 提供 Docker 部署方案

[详细文档](./blind-watermark-web/README_DEPLOY.md)

### blind-watermark-utools

[uTools](https://u.tools/) 插件版盲水印工具，基于 Vue 3 + Vite。

- 本地运行，无需服务器
- 支持拖拽上传、文件对话框选择
- 嵌入后自动下载
- 自带算法自检功能

## 技术原理

两个项目均采用相同的核心算法：

- **DWT（离散小波变换）**：对图像进行两级 Haar 小波变换
- **QIM（量化索引调制）**：在 LL 子带系数上嵌入水印 bit
- **纠错编码**：重复因子 7，提高鲁棒性
- **密码保护**：基于密码的 PRNG 生成加密序列和嵌入位置

## 快速开始

### Web 版

```bash
cd blind-watermark-web
pip install -r requirements.txt
python app.py
```

访问 `http://localhost:5000`

### uTools 插件

```bash
cd blind-watermark-utools
npm install
npm run build
```

将 `dist` 目录作为 uTools 插件加载。

## 部署

Web 版支持 Docker 部署：

```bash
cd blind-watermark-web
docker compose up -d --build
```

详细部署说明见 [blind-watermark-web/README_DEPLOY.md](./blind-watermark-web/README_DEPLOY.md)

## 致谢

- [blind_watermark](https://github.com/guofei9987/blind_watermark) — 原始盲水印算法实现（作者：guofei9987）
- [uTools](https://u.tools/) — 桌面插件平台

## 声明

本项目为二次开发作品，Web 版基于 guofei9987 的 [blind_watermark](https://github.com/guofei9987/blind_watermark) 项目进行封装和扩展，uTools 插件参考其算法思路独立实现。

原始项目的版权归原作者所有。本项目的二次开发行为遵循原项目的开源协议，如有侵权请通过 Issues 联系，核实后将立即删除相关内容。

本项目仅供学习交流使用，请勿用于商业用途。使用者应自行承担因使用本项目而产生的一切风险和责任。
