# Локальний сервер для розробки: віддає файли без кешу, щоб браузер
# не показував стару версію після правок.
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass

ThreadingHTTPServer(('127.0.0.1', 8899), NoCache).serve_forever()
