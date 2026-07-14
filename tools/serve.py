"""Serve the invitation locally with GitHub Pages-style 404 fallback routing."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class GitHubPagesHandler(SimpleHTTPRequestHandler):
    """Return 404.html for unknown paths so private invitation URLs work."""

    def send_error(
        self,
        code: int,
        message: str | None = None,
        explain: str | None = None,
    ) -> None:
        if code == 404:
            self.path = "/404.html"
            self.do_GET()
            return

        super().send_error(code, message, explain)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="local port to use (default: 8000)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    handler = partial(GitHubPagesHandler, directory=str(PROJECT_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)

    print(f"Wedding invitation: http://localhost:{args.port}")
    print("Use a private path from invitation-links.private.txt to open an invitation.")
    print("Press Ctrl+C to stop the server.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
