#!/usr/bin/env python3
"""Web shell plus compatibility API for legacy Web watermarks.

The current BWM2 workflow runs entirely in the browser. The two upload routes
remain stable so existing integrations can embed/extract the historical
``blind-watermark`` package format.
"""

from __future__ import annotations

import base64
import os
import uuid
from pathlib import Path

import cv2
import numpy as np
from blind_watermark import WaterMark
from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge


APP_DIR = Path(__file__).resolve().parent
SHARED_DIR = APP_DIR.parent / "shared"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_WATERMARK_BYTES = 512
MAX_LEGACY_WATERMARK_BITS = 1_000_000
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}

app = Flask(__name__)
app.config.update(
    # Leave room for multipart field and boundary overhead while keeping the
    # decoded file itself capped at MAX_UPLOAD_BYTES in read_uploaded_image().
    MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES,
    JSON_AS_ASCII=False,
)


class ApiInputError(ValueError):
    """A safe validation message that may be returned to API clients."""

    def __init__(self, message: str, code: str = "INPUT_INVALID") -> None:
        super().__init__(message)
        self.code = code


def api_error(message: str, status: int, code: str, request_id: str | None = None):
    payload = {"error": message, "code": code}
    if request_id:
        payload["request_id"] = request_id
    return jsonify(payload), status


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def parse_legacy_password(raw_value: str | None) -> int:
    value = "1" if raw_value is None or raw_value == "" else raw_value
    if not value.isascii() or not value.isdecimal():
        raise ApiInputError("旧版 Web 密码必须是非负整数", "PASSWORD_INVALID")
    password = int(value)
    if password > 2**31 - 1:
        raise ApiInputError("旧版 Web 密码不能大于 2147483647", "PASSWORD_INVALID")
    return password


def read_uploaded_image():
    if "image" not in request.files:
        raise ApiInputError("请上传图片", "FILE_REQUIRED")

    uploaded = request.files["image"]
    if not uploaded.filename or not allowed_file(uploaded.filename):
        raise ApiInputError("仅支持 PNG、JPG、BMP、WebP 图片", "FILE_TYPE_INVALID")
    file_bytes = uploaded.read(MAX_UPLOAD_BYTES + 1)
    if not file_bytes or len(file_bytes) > MAX_UPLOAD_BYTES:
        raise ApiInputError("图片不能为空且不能超过 20 MB", "FILE_SIZE_EXCEEDED")

    encoded = np.frombuffer(file_bytes, np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ApiInputError("无法读取图片，请确认文件未损坏", "IMAGE_DECODE_FAILED")
    if image.shape[0] * image.shape[1] > MAX_IMAGE_PIXELS:
        raise ApiInputError("图片像素过大，最高支持 2500 万像素", "PIXEL_LIMIT_EXCEEDED")
    if image.dtype != np.uint8:
        raise ApiInputError("旧版 Web 兼容模式仅支持 8 位图片", "IMAGE_DEPTH_UNSUPPORTED")

    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.ndim == 3 and image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    elif image.ndim != 3 or image.shape[2] != 3:
        raise ApiInputError("图片通道格式不受支持", "IMAGE_CHANNELS_UNSUPPORTED")
    return image


def encode_png(image: np.ndarray) -> bytes:
    success, encoded = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("OpenCV failed to encode PNG")
    return encoded.tobytes()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/shared/watermark-core.js")
def shared_watermark_core():
    return send_from_directory(SHARED_DIR, "watermark-core.js", mimetype="text/javascript")


@app.get("/healthz")
def healthz():
    return jsonify(status="ok", version="2")


@app.post("/api/embed")
def api_embed():
    """Embed the historical Web format for backwards-compatible clients."""
    try:
        image = read_uploaded_image()
        watermark = request.form.get("watermark", "")
        if not watermark.strip():
            raise ApiInputError("请输入水印内容", "WATERMARK_REQUIRED")
        try:
            watermark_bytes = watermark.encode("ascii", errors="strict")
        except UnicodeEncodeError as exc:
            raise ApiInputError(
                "旧版 Web 格式仅支持 ASCII；中文和 Emoji 请使用页面中的 BWM2 新版",
                "WATERMARK_ENCODING_UNSUPPORTED",
            ) from exc
        if len(watermark_bytes) > MAX_WATERMARK_BYTES:
            raise ApiInputError("旧版水印内容不能超过 512 字节", "WATERMARK_TOO_LONG")
        password = parse_legacy_password(request.form.get("password"))

        if request.form.get("compress", "1") == "1":
            height, width = image.shape[:2]
            if max(height, width) > 1600:
                scale = 1600 / max(height, width)
                image = cv2.resize(
                    image,
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    interpolation=cv2.INTER_AREA,
                )

        engine = WaterMark(password_wm=password, password_img=password)
        engine.read_img(img=image)
        engine.read_wm(watermark, mode="str")
        result = engine.embed()
        image_base64 = base64.b64encode(encode_png(result)).decode("ascii")
        return jsonify(
            image=image_base64,
            wm_size=engine.wm_size,
            algorithm="python-blind-watermark-v1",
            warning="旧版格式不含完整性校验，建议迁移到 BWM2",
        )
    except RequestEntityTooLarge:
        raise
    except ApiInputError as error:
        return api_error(str(error), 422, error.code)
    except Exception:
        request_id = uuid.uuid4().hex[:12]
        app.logger.exception("Legacy embed failed request_id=%s", request_id)
        return api_error("嵌入失败，请检查图片和参数", 500, "PROCESSING_FAILED", request_id)


@app.post("/api/extract")
def api_extract():
    """Extract the historical Web format for backwards-compatible clients."""
    try:
        image = read_uploaded_image()
        raw_length = request.form.get("wm_length", "")
        if not raw_length.isascii() or not raw_length.isdecimal():
            raise ApiInputError("水印长度必须是正整数", "WATERMARK_LENGTH_INVALID")
        watermark_length = int(raw_length)
        if watermark_length <= 0 or watermark_length > MAX_LEGACY_WATERMARK_BITS:
            raise ApiInputError("水印长度超出允许范围", "WATERMARK_LENGTH_INVALID")
        password = parse_legacy_password(request.form.get("password"))

        engine = WaterMark(password_wm=password, password_img=password)
        result = engine.extract(
            embed_img=image,
            wm_shape=watermark_length,
            mode="str",
        )
        return jsonify(
            watermark=result,
            wm_length=watermark_length,
            algorithm="python-blind-watermark-v1",
            verified=False,
            warning="旧版格式无法校验密码和内容是否正确",
        )
    except RequestEntityTooLarge:
        raise
    except ApiInputError as error:
        return api_error(str(error), 422, error.code)
    except Exception:
        request_id = uuid.uuid4().hex[:12]
        app.logger.exception("Legacy extract failed request_id=%s", request_id)
        return api_error("提取失败，请检查图片、密码和水印长度", 422, "EXTRACTION_FAILED", request_id)


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_error):
    if request.path.startswith("/api/"):
        return api_error("图片不能超过 20 MB", 413, "FILE_SIZE_EXCEEDED")
    return "Request too large", 413


@app.after_request
def add_response_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; img-src 'self' data: blob:; style-src 'self'; "
        "script-src 'self'; worker-src 'self'; connect-src 'self'"
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.path == "/":
        response.headers["Cache-Control"] = "no-cache"
    else:
        response.headers.setdefault("Cache-Control", "public, max-age=3600")
    if request.is_secure or request.headers.get("X-Forwarded-Proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=debug, threaded=True)
