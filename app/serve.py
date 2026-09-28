"""Cross-platform WSGI entry point: python -m app.serve."""
import os


def main():
    from waitress import serve
    from app.backend import app
    service = app.extensions["dineiq_service"]
    if not service.ready:
        raise SystemExit(f"Serving preflight failed: {service.load_error}")
    serve(app, host=os.environ.get("DINEIQ_BIND", "127.0.0.1"),
          port=int(os.environ.get("DINEIQ_PORT", "5000")), threads=4,
          max_request_body_size=1024 * 1024)


if __name__ == "__main__":
    main()
