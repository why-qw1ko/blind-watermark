# Web 版部署说明

Web 版的 BWM2 嵌入、提取和批量处理均在浏览器本地完成。服务器只提供静态页面；仅当用户主动选择“旧版 Web”兼容提取时，图片才会上传到 `/api/extract`。

## Docker Compose

要求 Docker Engine 24+ 与 Docker Compose v2。从 `blind-watermark-web` 目录执行：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8080/healthz
```

服务默认只监听宿主机 `127.0.0.1:8080`，避免绕过 HTTPS 直接暴露公网。停止服务：

```bash
docker compose down
```

## 生产 HTTPS

生产环境必须在 `127.0.0.1:8080` 前配置 HTTPS 反向代理。不要直接把 Compose 中的监听地址改成 `0.0.0.0` 后裸露到公网，因为通过 HTTP 加载的页面脚本可以被篡改，进而读取用户在浏览器中处理的图片。

例如，已安装 Caddy 且域名解析完成时，可使用：

```text
watermark.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

也可以使用现有的 Nginx、Traefik 或云负载均衡终止 TLS。上游代理应传递 `X-Forwarded-Proto: https`。

## 资源与安全边界

- 浏览器新版：最多 10 张、20 MB/张、80 MB/批；默认将长边限制为 1600px。
- 旧版兼容 API：单次 20 MB、最高 2500 万像素；Nginx 限制为每 IP 每分钟 10 次并限制并发连接。
- 应用容器不对宿主机暴露端口，使用非 root 用户运行并带健康检查。
- API 响应禁止缓存，不记录图片、水印内容或密码。
- 处理是 CPU 密集型任务。小型主机建议保持默认 2 个 Gunicorn worker，不要按 I/O 服务的方式盲目提高并发。

## 本地开发

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

默认仅监听 `127.0.0.1:5000` 且关闭调试。需要调试时显式设置 `FLASK_DEBUG=1`，不要在公网环境开启。

## 验证

```bash
python -m unittest discover -s tests -v
```

浏览器中再验证一次：单张嵌入/提取、批量 ZIP、错误密码、窄屏布局，以及 Web 与 uTools 互提。
