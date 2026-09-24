#!/usr/bin/env python3
"""Dev server that never caches, so a reload always shows the latest build."""
import http.server, functools, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))
http.server.HTTPServer(("0.0.0.0", 5173), H).serve_forever()
