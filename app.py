#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Blind Watermark Web App
基于 blind_watermark 的网页版盲水印工具
"""

import io
import os
import sys
import tempfile

import cv2
import numpy as np
from flask import Flask, render_template, request, send_file, jsonify

from blind_watermark import WaterMark

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 限制上传 20MB

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def read_image_from_bytes(file_bytes):
    """从字节流读取图片为 numpy 数组"""
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    return img


def image_to_bytes(img, fmt='.png'):
    """将 numpy 数组转为 PNG 字节流"""
    _, buffer = cv2.imencode(fmt, img)
    return io.BytesIO(buffer.tobytes())


# ─── 路由 ───────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/embed', methods=['POST'])
def api_embed():
    """嵌入水印"""
    # 参数校验
    if 'image' not in request.files:
        return jsonify(error='请上传图片'), 400

    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify(error='请上传有效的图片文件 (png/jpg/jpeg/bmp/webp)'), 400

    watermark = request.form.get('watermark', '').strip()
    if not watermark:
        return jsonify(error='请输入水印内容'), 400

    password = request.form.get('password', '1').strip()
    try:
        password = int(password)
    except ValueError:
        password = 1

    # 读取图片
    img_bytes = file.read()
    img = read_image_from_bytes(img_bytes)
    if img is None:
        return jsonify(error='图片读取失败，请检查文件'), 400

    # 嵌入水印
    try:
        bwm = WaterMark(password_wm=password, password_img=password)
        bwm.read_img(img=img)
        bwm.read_wm(watermark, mode='str')
        result = bwm.embed()
        wm_len = bwm.wm_size
    except Exception as e:
        return jsonify(error=f'嵌入失败: {str(e)}'), 500

    # 返回图片 + wm_size
    import base64
    buf = image_to_bytes(result, '.png')
    img_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    return jsonify(image=img_b64, wm_size=wm_len)


@app.route('/api/extract', methods=['POST'])
def api_extract():
    """提取水印"""
    if 'image' not in request.files:
        return jsonify(error='请上传图片'), 400

    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify(error='请上传有效的图片文件'), 400

    wm_length = request.form.get('wm_length', '').strip()
    if not wm_length:
        return jsonify(error='请输入水印长度（嵌入时显示的 bit 数）'), 400
    try:
        wm_length = int(wm_length)
    except ValueError:
        return jsonify(error='水印长度必须为整数'), 400

    password = request.form.get('password', '1').strip()
    try:
        password = int(password)
    except ValueError:
        password = 1

    # 读取图片
    img_bytes = file.read()
    img = read_image_from_bytes(img_bytes)
    if img is None:
        return jsonify(error='图片读取失败'), 400

    # 提取水印
    try:
        bwm = WaterMark(password_wm=password, password_img=password)
        result = bwm.extract(embed_img=img, wm_shape=wm_length, mode='str')
    except Exception as e:
        return jsonify(error=f'提取失败: {str(e)}'), 500

    return jsonify(watermark=result, wm_length=wm_length)


# ─── 启动 ───────────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
