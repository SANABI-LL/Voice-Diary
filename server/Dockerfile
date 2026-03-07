FROM node:20-slim

WORKDIR /app

# 在 /app 顶层安装依赖，server/ 和 api/ 都能访问到 node_modules
COPY server/package*.json ./
RUN npm install --production

# 保持目录结构，确保 server/index.js 的 ../api/ 路径能正确解析
COPY server/index.js ./server/
COPY public/ ./public/
COPY api/ ./api/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
