from __future__ import annotations

import base64
import io
import unittest
from unittest.mock import patch

import cv2
import numpy as np

import app as web_app


def png_bytes(channels: int = 3, width: int = 256, height: int = 256) -> bytes:
    y, x = np.indices((height, width))
    if channels == 1:
        image = ((x * 7 + y * 11) % 256).astype(np.uint8)
    else:
        image = np.stack(
            [
                (x * 3 + y * 5) % 256,
                (x * 7 + y * 11) % 256,
                (x * 13 + y * 17) % 256,
            ],
            axis=2,
        ).astype(np.uint8)
    success, encoded = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("test image encoding failed")
    return encoded.tobytes()


class WebAppTests(unittest.TestCase):
    def setUp(self) -> None:
        web_app.app.config.update(TESTING=True)
        self.client = web_app.app.test_client()

    def test_page_and_shared_core_are_served_with_security_headers(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("图片盲水印", response.get_data(as_text=True))
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")

        core_response = self.client.get("/shared/watermark-core.js")
        self.assertEqual(core_response.status_code, 200)
        self.assertIn("BWM2", core_response.get_data(as_text=True))
        core_response.close()

    def test_workspace_and_help_are_separate_pages(self) -> None:
        workspace = self.client.get("/")
        help_response = self.client.get("/help")
        self.assertEqual(workspace.status_code, 200)
        self.assertEqual(help_response.status_code, 200)
        self.assertEqual(help_response.headers["Cache-Control"], "no-cache")
        workspace_html = workspace.get_data(as_text=True)
        help_html = help_response.get_data(as_text=True)
        self.assertIn('id="embed-form"', workspace_html)
        self.assertNotIn('id="faq"', workspace_html)
        self.assertIn('id="faq"', help_html)
        self.assertNotIn('id="embed-form"', help_html)
        self.assertIn('static/app.js', workspace_html)
        self.assertNotIn('static/app.js', help_html)
        self.assertIn('static/help.js', help_html)
        self.assertIn('href="/help"', workspace_html)
        self.assertNotIn('target="_blank"', workspace_html)
        self.assertIn('href="/"', help_html)

    def test_health_check(self) -> None:
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok", "version": "2"})

    def test_legacy_embed_accepts_grayscale_and_round_trips_ascii(self) -> None:
        embed_response = self.client.post(
            "/api/embed",
            data={
                "image": (io.BytesIO(png_bytes(channels=1)), "gray.png"),
                "watermark": "owner-42",
                "password": "123",
                "compress": "0",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(embed_response.status_code, 200)
        payload = embed_response.get_json()
        self.assertEqual(payload["algorithm"], "python-blind-watermark-v1")

        extract_response = self.client.post(
            "/api/extract",
            data={
                "image": (io.BytesIO(base64.b64decode(payload["image"])), "watermarked.png"),
                "wm_length": str(payload["wm_size"]),
                "password": "123",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(extract_response.status_code, 200)
        self.assertEqual(extract_response.get_json()["watermark"], "owner-42")
        self.assertFalse(extract_response.get_json()["verified"])

    def test_legacy_api_rejects_ambiguous_inputs(self) -> None:
        bad_password = self.client.post(
            "/api/embed",
            data={
                "image": (io.BytesIO(png_bytes()), "image.png"),
                "watermark": "owner",
                "password": "not-a-number",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(bad_password.status_code, 422)
        self.assertEqual(bad_password.get_json()["code"], "PASSWORD_INVALID")

        unicode_watermark = self.client.post(
            "/api/embed",
            data={
                "image": (io.BytesIO(png_bytes()), "image.png"),
                "watermark": "中文",
                "password": "1",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(unicode_watermark.status_code, 422)
        self.assertEqual(unicode_watermark.get_json()["code"], "WATERMARK_ENCODING_UNSUPPORTED")

        zero_length = self.client.post(
            "/api/extract",
            data={
                "image": (io.BytesIO(png_bytes()), "image.png"),
                "wm_length": "0",
                "password": "1",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(zero_length.status_code, 422)
        self.assertEqual(zero_length.get_json()["code"], "WATERMARK_LENGTH_INVALID")

    def test_processing_errors_do_not_expose_internal_details(self) -> None:
        with patch.object(web_app, "WaterMark", side_effect=RuntimeError("secret stack detail")):
            response = self.client.post(
                "/api/embed",
                data={
                    "image": (io.BytesIO(png_bytes()), "image.png"),
                    "watermark": "owner",
                    "password": "1",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 500)
        body = response.get_json()
        self.assertEqual(body["code"], "PROCESSING_FAILED")
        self.assertNotIn("secret stack detail", response.get_data(as_text=True))
        self.assertIn("request_id", body)

    def test_oversized_api_request_returns_json(self) -> None:
        original_limit = web_app.app.config["MAX_CONTENT_LENGTH"]
        web_app.app.config["MAX_CONTENT_LENGTH"] = 128
        try:
            response = self.client.post(
                "/api/embed",
                data={
                    "image": (io.BytesIO(b"x" * 512), "image.png"),
                    "watermark": "owner",
                    "password": "1",
                },
                content_type="multipart/form-data",
            )
        finally:
            web_app.app.config["MAX_CONTENT_LENGTH"] = original_limit
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json()["code"], "FILE_SIZE_EXCEEDED")
        self.assertEqual(response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
