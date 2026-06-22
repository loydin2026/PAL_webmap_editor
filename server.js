const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;

// MIME 类型映射
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  // 处理 URL 路径
  let urlPath = decodeURIComponent(req.url);
  if (urlPath === '/') urlPath = '/index.html';

  // 移除开头的斜杠
  const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;

  // 尝试在当前目录 (web-map-editor) 中查找文件
  let filePath = path.join(__dirname, relativePath);

  // 如果文件不存在，尝试在上级目录的上级目录（项目根目录）中查找
  // 这用于访问 ../gop/、../map/、../Pat.mkf 等资源
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const altPath = path.join(__dirname, '..', '..', relativePath);
    if (fs.existsSync(altPath) && !fs.statSync(altPath).isDirectory()) {
      filePath = altPath;
    }
  }

  // 安全路径检查：防止目录遍历攻击
  const resolvedPath = path.resolve(filePath);
  const allowedRoots = [
    path.resolve(__dirname),
    path.resolve(__dirname, '..', '..'),
  ];
  const isAllowed = allowedRoots.some(root => resolvedPath.startsWith(root));
  if (!isAllowed) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found: ' + req.url);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error: ' + err.code);
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('仙剑地图编辑器 服务器已启动');
  console.log('访问地址: http://localhost:' + PORT + '/');
  console.log('按 Ctrl+C 停止服务器');
});
