部署说明

1) 前提（你的服务器已经安装了 Docker 与 docker-compose）：
   - 已确认：你的服务器已安装 Docker
   - 如果尚未安装 docker compose 插件，请安装（多数新 Docker 已内置 `docker compose`）

2) 我在仓库中添加了以下部署文件（已提交到 main 分支）：
   - Dockerfile
   - docker-compose.yml
   - deploy/nginx.conf
   - .dockerignore

   它们会把 Flask 应用运行在容器中，并提供一个 nginx 容器作为反向代理（监听 80 端口，转发到 app:8000）。

3) 在服务器上部署（最简命令）：
   # 克隆或进入你的仓库目录
   git clone https://github.com/why-qw1ko/blind-watermark-web.git
   cd blind-watermark-web

   # 构建并在后台启动容器
   docker compose up -d --build

   # 查看日志
   docker compose logs -f app

   # 检查容器状态
   docker compose ps

   现在可以通过服务器 IP 或绑定到服务器的域名访问 HTTP（端口 80）。

4) 如果你希望使用 HTTPS (推荐)：
   - 你需要一个域名指向这台服务器的公网 IP。
   - 我可以帮你把 certbot 自动化加入（使用 certbot docker 或在主机安装 certbot），或者你也可以手动运行 certbot 来申请 Let\'s Encrypt 证书。
   - 如果你要我自动申请证书，请提供域名并允许我在仓库中添加 certbot 相关的 docker-compose 服务与说明。

5) 关于静态文件与模板：
   - 你的 Flask 模板位于 templates/，静态文件位于仓库根或 templates 下（取决代码）。nginx 当前配置将所有请求代理到 Flask，而不单独处理静态文件。如果你想让 nginx 直接托管静态资源以提高性能，我可以调整配置。

6) 运行与调试：
   - 若遇到错误，运行 `docker compose logs -f app` 看错误输出。
   - 常见问题：缺少系统库（opencv 可能需要系统依赖），我在 Dockerfile 已安装 libgl1 和 libglib2.0-0 如需额外库我可以补充。

7) 我可以继续帮你：
   - 如果你授权，我可以在仓库里进一步添加 certbot 服务并帮你完成 HTTPS 的自动配置（你需要在 DNS 把域名 A 记录指向本服务器）。
   - 或者我可以只给你具体在服务器上执行的命令和步骤，你手动执行。

告诉我你是否希望我继续：
- A) 我现在把 certbot + 自动 HTTPS 加到 docker-compose（请提供域名）
- B) 我只需要你自己在服务器上运行上面步骤并告诉我遇到的错误

