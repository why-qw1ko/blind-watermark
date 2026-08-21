# 部署说明

## 前提条件

- 服务器已安装 Docker 和 Docker Compose
- 如需 HTTPS，需要域名并配置 DNS A 记录指向服务器公网 IP

## 部署文件

```
blind-watermark-web/
├── Dockerfile
├── docker-compose.yml
├── deploy/nginx.conf
└── .dockerignore
```

Flask 应用运行在容器内，Nginx 作为反向代理监听 80 端口并转发到 `app:8000`。

## 部署步骤

```bash
# 克隆仓库
git clone https://github.com/why-qw1ko/blind-watermark-web.git
cd blind-watermark-web

# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f app

# 检查状态
docker compose ps
```

部署完成后通过服务器 IP 或绑定的域名访问 HTTP（端口 80）。

## HTTPS 配置

推荐使用 Let's Encrypt 免费证书：

1. 确保域名 A 记录已指向服务器 IP
2. 安装 certbot
3. 申请证书并配置 Nginx

或使用 Certbot Docker 容器自动续期。

## 静态文件

Flask 模板位于 `templates/`，Nginx 默认将所有请求代理到 Flask。如需 Nginx 直接托管静态资源以提升性能，可修改 `deploy/nginx.conf` 配置。

## 常见问题

- **OpenCV 依赖缺失**：Dockerfile 已包含 `libgl1` 和 `libglib2.0-0`，如遇其他依赖问题可补充安装
- **容器启动失败**：运行 `docker compose logs -f app` 查看错误日志
